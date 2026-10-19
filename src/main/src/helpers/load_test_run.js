const crypto = require('crypto');
const is_localhost_url = require('./is_localhost_url');
const k6_lane = require('./k6_lane');
const k6_script = require('./k6_script');
const k6_summary_mark = require('./k6_summary_mark');
const load_test_log_write = require('./load_test_log_write');
const load_test_runs_write = require('./load_test_runs_write');
const load_test_url = require('./load_test_url');
const log_event = require('./log_event');
const remote_call = require('./remote_call');
const service_ensure_running = require('./service_ensure_running');
const tailnet_ip_read = require('./tailnet_ip_read');

const K6_IMAGE = 'grafana/k6';
// Pulling k6 the first time is the slow part; the run itself is as long as the test says
const PULL_MS = 900000;

// k6 prints its own summary for the log, and exports the numbers for serviceman. It writes a
// warning for every failed request, thousands a second against a dead address: they go to a
// file and come out once each, counted, when the run is over.
const K6_SHELL = [
    'printf %s "$K6_SCRIPT" | base64 -d > /tmp/test.js',
    'k6 run --log-output=file=/tmp/k6.log --summary-export=/tmp/summary.json /tmp/test.js',
    'code=$?',
    'sed \'s/^time="[^"]*" //\' /tmp/k6.log | sort | uniq -c | sort -rn | head -5 >&2',
    `[ -f /tmp/summary.json ] && echo "${k6_summary_mark}$(tr -d '\\n' < /tmp/summary.json)"`,
    'exit $code',
].join('\n');

// Sends k6 at a service: the service is woken first, so its start is not taken for slow
// answers, then k6 runs once on the test's remote, in a container removed afterwards. The run
// is answered at once; what it measures lands on it as it goes.
function load_test_run(app, test)
{
    const out = {
        id: crypto.randomBytes(4).toString('hex'),
        test: test.name,
        service: test.service,
        remote: test.remote,
        url: load_test_url(app, test),
        vus: test.vus,
        duration: test.duration,
        duration_ms: test.duration_ms,
        p95_ms: test.p95_ms,
        errors_pct: test.errors_pct,
        phase: 'waking',
        started_at: Date.now(),
        ended_at: null,
        wake_ms: null,
        live: null,
        // What k6 printed, the last few thousand lines; written down when the run ends
        lines: [],
        lines_dropped: 0,
        log_kept: false,
        result: null,
        error: null,
        // Where a .localhost name was sent: serviceman on the tailnet, or the remote's loopback
        via: null,
        // What k6 complained of, each once, with how many times: [{count, text}]
        said: [],
    };
    app.load_test_runs.push(out);
    log_event(app, 'load_test_start', {test: test.name, run: out.id, remote: test.remote, url: out.url});
    run(app, test, out).catch(function (error) {
        out.error = error.message;
        out.phase = (out.phase === 'stopping') ? 'stopped' : 'error';
    }).finally(function () {
        out.ended_at = Date.now();
        out.live = null;
        log_event(app, 'load_test_end', {test: out.test, run: out.id, phase: out.phase, error: out.error});
        load_test_log_write(app, out);
        out.log_kept = true;
        load_test_runs_write(app);
    });
    return out;
}

async function run(app, test, test_run)
{
    if (test_run.url === null) {
        throw new Error(`${test.service} has no address to ask — give the test one`);
    }
    const service = app.service_by_name[test.service];
    if ((service !== undefined) && (service.type !== 'external')) {
        const time0 = Date.now();
        await service_ensure_running(app, service);
        test_run.wake_ms = Date.now() - time0;
    }
    const remote = app.remote_by_name[test.remote];
    if (remote === undefined) {
        throw new Error(`no remote named ${test.remote}`);
    }
    if (test_run.phase === 'stopping') {
        throw new Error('stopped before k6 started');
    }
    // A .localhost name is serviceman's: from a remote it is reached where serviceman is on the
    // tailnet. A serviceman with no tailnet is reached only from the remote on its own machine.
    let ip = null;
    if (is_localhost_url(test_run.url)) {
        const tailnet = await tailnet_ip_read();
        ip = (tailnet === null) ? '127.0.0.1' : tailnet;
        test_run.via = (tailnet === null) ? 'the remote\'s own loopback: this serviceman is not on a tailnet' : `serviceman on the tailnet, at ${tailnet}`;
    }
    test_run.phase = 'running';
    const script = Buffer.from(k6_script(test, test_run.url, ip)).toString('base64');
    const argv = ['run', '--rm', '--name', `serviceman-k6-${test_run.id}`, '--network', 'host', '-e', `K6_SCRIPT=${script}`, '--entrypoint', 'sh', K6_IMAGE, '-c', K6_SHELL];
    const answer = await remote_call(app, remote, 'docker', {argv, service: `${k6_lane}${test_run.id}`}, PULL_MS + test.duration_ms);
    if (test_run.phase === 'stopping') {
        test_run.phase = 'stopped';
        return;
    }
    test_run.said = said_from_stderr(answer.stderr);
    const line = answer.stdout.split('\n').find(v => v.startsWith(k6_summary_mark));
    if (line === undefined) {
        const said = answer.stderr.split('\n').filter(v => v.trim() !== '');
        throw new Error(`k6 ended with no numbers (exit ${answer.code})${(said.length === 0) ? '' : `: ${said[said.length - 1]}`}`);
    }
    test_run.result = result_from_export(JSON.parse(line.slice(k6_summary_mark.length)));
    const slow = (test.p95_ms !== null) && (test_run.result.p95_ms >= test.p95_ms);
    const failing = (test.errors_pct !== null) && (test_run.result.errors > test.errors_pct/100);
    test_run.result.p95_passed = (slow === false);
    test_run.result.errors_passed = (failing === false);
    test_run.phase = (slow || failing) ? 'failed' : 'passed';
}

// What --summary-export wrote -> the numbers a run keeps. A run that never got an answer has
// no timings at all.
function result_from_export(json)
{
    const reqs = json.metrics.http_reqs || {count: 0, rate: 0};
    const duration = json.metrics.http_req_duration || {};
    const failed = json.metrics.http_req_failed || {};
    return {
        reqs: reqs.count,
        rps: reqs.rate,
        med_ms: (duration.med === undefined) ? null : duration.med,
        p95_ms: (duration['p(95)'] === undefined) ? null : duration['p(95)'],
        max_ms: (duration.max === undefined) ? null : duration.max,
        errors: (failed.value === undefined) ? null : failed.value,
    };
}

// `  40196 level=warning msg="Request Failed" error="Get …: connection refused"` ->
// {count, text, users}. A line the script wrote itself is each user's first bad answer, so its
// count is users; any other line k6 wrote is counted in requests.
function said_from_stderr(stderr)
{
    const out = [];
    for (const line of stderr.split('\n')) {
        const match = /^\s*([0-9]+) level=[a-z]+ (.*)$/.exec(line);
        // A crossed threshold is the verdict, which the run already has
        if ((match === null) || match[2].includes('have been crossed')) {
            continue;
        }
        const msg = field_of(match[2], 'msg');
        const error = field_of(match[2], 'error');
        out.push({
            count: parseInt(match[1], 10),
            text: (msg === null) ? match[2] : ((error === null) ? msg : `${msg}: ${error}`),
            users: match[2].endsWith('source=console'),
        });
    }
    return out;
}

// `msg="Request Failed" error="Get \"http://…\": refused"`, 'error' -> `Get "http://…": refused`
function field_of(text, name)
{
    const match = new RegExp(`(?:^| )${name}="((?:[^"\\\\]|\\\\.)*)"`).exec(text);
    return (match === null) ? null : match[1].replace(/\\(.)/g, '$1');
}

module.exports = load_test_run;
