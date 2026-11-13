const assert = require('assert');
const problems_apply = require('../src/main/src/helpers/problems_apply');
const problems_from_containers = require('../src/main/src/helpers/problems_from_containers');
const problems_from_logline = require('../src/main/src/helpers/problems_from_logline');
const test = require('node:test');

const NOW = Date.parse('2026-10-16T09:00:00Z');
const MOUNT_ERROR = 'failed to create task for container: error mounting "/home/user/logline/config/clickhouse.xml" to rootfs at "/etc/clickhouse-server/users.d/log-ui.xml": not a directory';

test('a container Docker was meant to keep running that cannot start is a problem, its missing file named', function () {
    const list = [container('a1', 'logline-clickstack-1', 'exited')];
    const inspect = {a1: inspected('unless-stopped', 'exited', 127, MOUNT_ERROR)};
    const found = problems_from_containers('vps1', list, inspect, []);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].key, 'container_down:vps1:logline-clickstack-1');
    assert.match(found[0].cause, /\/home\/user\/logline\/config\/clickhouse\.xml is not there/);
    assert.match(found[0].fix, /docker start logline-clickstack-1/);
    assert.strictEqual(found[0].since, Date.parse('2026-10-16T05:52:16Z'));
});

test('a container someone stopped, one with no restart policy, and serviceman\'s own are not problems', function () {
    const list = [container('b1', 'stopped-by-hand', 'exited'), container('b2', 'stopped-by-docker-stop', 'exited'), container('b3', 'one-off', 'exited'), container('b4', 'serviceman-echo', 'exited'), container('b5', 'stopped-while-failing', 'exited'), container('b6', 'ends-with-2-on-stop', 'exited'), container('b7', 'on-failure-stopped-by-hand', 'exited')];
    const inspect = {
        b1: inspected('unless-stopped', 'exited', 0, ''),
        b2: inspected('always', 'exited', 143, ''),
        b3: inspected('no', 'exited', 1, ''),
        b4: inspected('unless-stopped', 'exited', 1, ''),
        b5: inspected('unless-stopped', 'exited', 1, ''),
        b6: inspected('always', 'exited', 2, ''),
        b7: Object.assign(inspected('on-failure', 'exited', 1, ''), {HostConfig: {RestartPolicy: {Name: 'on-failure', MaximumRetryCount: 5}}, RestartCount: 2}),
    };
    assert.deepStrictEqual(problems_from_containers('vps1', list, inspect, []), []);
});

test('a container Docker gave up on after its on-failure tries is a problem, the tries named', function () {
    const list = [container('e1', 'gave-up', 'exited')];
    const inspect = {e1: Object.assign(inspected('on-failure', 'exited', 1, ''), {HostConfig: {RestartPolicy: {Name: 'on-failure', MaximumRetryCount: 5}}, RestartCount: 5})};
    const found = problems_from_containers('vps1', list, inspect, []);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].cause, 'it failed 5 times in a row (exit 1), and Docker stopped trying, as its restart policy says');
});

test('a container Docker keeps restarting is a problem', function () {
    const list = [container('c1', 'crashes', 'restarting')];
    const found = problems_from_containers('vps1', list, {c1: inspected('always', 'restarting', 1, '')}, []);
    assert.strictEqual(found.length, 1);
    assert.match(found[0].cause, /again and again/);
});

test('a running container whose mounted files are gone will not come back after a restart', function () {
    const list = [container('d1', 'viewer', 'running'), container('d2', 'fine', 'running')];
    const gone = [{id: 'd1', source: '/home/user/logline/log-ui/index.html'}, {id: 'd1', source: '/home/user/logline/log-ui/app.js'}];
    const found = problems_from_containers('vps1', list, {}, gone);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].key, 'files_gone:vps1:viewer');
    assert.match(found[0].cause, /files it mounts are gone from vps1: \/home\/user\/logline\/log-ui\/index\.html, \/home\/user\/logline\/log-ui\/app\.js/);
});

test('Logline refusing a machine is a problem, and the 401 of another address says to restart Docker', function () {
    const found = problems_from_logline('vps1', logline('401 not from an address this token was issued for', '2026-10-08T11:50:16Z', 690000, 250e6), NOW);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].key, 'logline_refused:vps1');
    assert.match(found[0].fix, /restart Docker/);
    assert.strictEqual(found[0].since, Date.parse('2026-10-08T11:50:16Z'));
});

test('a refusal of the lines themselves is not called a Logline that is down; a Logline that is away or failing still is', function () {
    const down = /Logline or the way to it is down/;
    // What the agent of SM-287 puts aside, and what an agent from before it does as well
    for (const answer of ['422 clickhouse 500: Code: 252. DB::Exception: Too many partitions for single INSERT block (more than 100).', '400 [3].time: expected an ISO time', '413 a batch is kept under 8388608 bytes', '413']) {
        const found = problems_from_logline('vps1', logline(answer, null, 5, 1000), NOW);
        assert.strictEqual(found[0].key, 'logline_refused:vps1');
        assert.doesNotMatch(found[0].fix, down, answer);
        assert.match(found[0].fix, /will never take these lines as they are.*refused\//, answer);
    }
    for (const answer of ['502 clickhouse 500: Code: 243. DB::Exception: Cannot reserve 1.00 MiB, not enough space.', '502 fetch failed', '500 Logline could not take that: its log says why', '404 Not Found', '429 Too Many Requests', 'connect ECONNREFUSED 100.64.0.20:3000', 'The operation was aborted due to timeout']) {
        assert.match(problems_from_logline('vps1', logline(answer, null, 5, 1000), NOW)[0].fix, down, answer);
    }
});

test('lines put aside on a machine are a problem of their own for as long as they are there, and say when no more fit', function () {
    const some = problems_from_logline('vps1', Object.assign(logline('ok', null, 0, 0), {aside: {files: 3, bytes: 4096, full: false}}), NOW);
    assert.deepStrictEqual(some.map(v => v.key), ['logline_aside:vps1'], 'while Logline takes every other line');
    assert.strictEqual(some[0].subject, 'Logline will not take some of vps1\'s lines');
    assert.match(some[0].cause, /^3 files of lines Logline refused are kept on the machine, in logline\/spool\/refused/);
    assert.match(some[0].fix, /send them by hand once fixed, or delete them/);
    const one = problems_from_logline('vps1', Object.assign(logline('ok', null, 0, 0), {aside: {files: 1, bytes: 300, full: false}}), NOW);
    assert.match(one[0].cause, /^1 file of lines Logline refused is kept/);
    // Full: the refused line waits in the spool, and the agent says what Logline answered
    const full = problems_from_logline('vps1', Object.assign(logline('422 clickhouse 500: Code: 407. DB::Exception: Decimal math overflow', null, 40, 9000), {aside: {files: 1000, bytes: 300000, full: true}}), NOW);
    assert.deepStrictEqual(full.map(v => v.key), ['logline_refused:vps1', 'logline_aside:vps1']);
    assert.strictEqual(full[1].subject, 'vps1 sends Logline nothing until its refused/ has room');
    assert.match(full[1].cause, /^1,000 files /);
    assert.match(full[1].fix, /move the files away or delete them/);
    // Nothing aside, an agent from before SM-287 that says nothing of it, a machine that does not collect
    assert.deepStrictEqual(problems_from_logline('vps1', Object.assign(logline('ok', null, 0, 0), {aside: {files: 0, bytes: 0, full: false}}), NOW), []);
    assert.deepStrictEqual(problems_from_logline('vps1', Object.assign(logline('ok', null, 0, 0), {aside: null}), NOW), []);
    assert.deepStrictEqual(problems_from_logline('vps1', logline('ok', null, 0, 0), NOW), []);
    assert.deepStrictEqual(problems_from_logline('vps1', Object.assign(logline('ok', null, 0, 0), {collecting: false, aside: {files: 3, bytes: 4096, full: false}}), NOW), []);
});

// The card says what Logline answered and since when, and that the machine sends nothing only
// once a line really waits: full alone holds nothing back until Logline refuses one more
test('lines put aside say why and since when, and are a failure only once a line waits for room', function () {
    const told = {answer: '400 [0].labels: expected an array of {name, value}', oldest_at: '2026-09-26T00:23:00.000Z', newest_at: '2026-09-26T00:27:00.000Z'};
    const full = problems_from_logline('vps1', Object.assign(logline('ok', null, 0, 0), {aside: Object.assign({files: 1175, bytes: 900000, full: true}, told)}), NOW);
    assert.deepStrictEqual(full.map(v => [v.key, v.level]), [['logline_aside:vps1', 'warn']], 'lines go: a warning');
    assert.strictEqual(full[0].subject, 'Logline refused vps1\'s lines, and no more fit aside');
    assert.strictEqual(full[0].cause, 'Logline answered: 400 [0].labels: expected an array of {name, value} · 1,175 files kept on the machine, in logline/spool/refused of its agent\'s folder');
    assert.match(full[0].fix, /^Lines still go\. Once Logline refuses one more, it waits with every line behind it/);
    assert.strictEqual(full[0].since, Date.parse('2026-09-26T00:23:00Z'), 'since the oldest file, not since serviceman started');

    const some = problems_from_logline('vps1', Object.assign(logline('ok', null, 0, 0), {aside: Object.assign({files: 502, bytes: 400000, full: false}, told)}), NOW);
    assert.deepStrictEqual([some[0].level, some[0].subject, some[0].since], ['warn', 'Logline will not take some of vps1\'s lines', Date.parse('2026-09-26T00:23:00Z')]);
    assert.match(some[0].cause, /^Logline answered: 400 \[0\]\.labels/);

    // Full, and Logline refused one more: that line waits with the lines behind it, since the oldest of them
    const held = problems_from_logline('vps1', Object.assign(logline('400 [0].line: expected a string', '2026-10-16T08:40:00Z', 40, 9000), {aside: Object.assign({files: 1000, bytes: 900000, full: true}, told)}), NOW);
    const card = held.find(v => v.key === 'logline_aside:vps1');
    assert.deepStrictEqual([card.level, card.subject, card.since], ['bad', 'vps1 sends Logline nothing until its refused/ has room', Date.parse('2026-10-16T08:40:00Z')]);
    // Full while Logline is away or the token is refused: not this card's failure, the other cards say it
    for (const answer of ['502 Bad Gateway', '429 slow down', '401 no such token', 'connect ECONNREFUSED 127.0.0.1:3100']) {
        const away = problems_from_logline('vps1', Object.assign(logline(answer, '2026-10-16T08:40:00Z', 40, 9000), {aside: Object.assign({files: 1000, bytes: 900000, full: true}, told)}), NOW);
        assert.strictEqual(away.find(v => v.key === 'logline_aside:vps1').level, 'warn', answer);
    }
    // An agent from before the answer and the times: the counts, as before
    const old = problems_from_logline('vps1', Object.assign(logline('ok', null, 0, 0), {aside: {files: 3, bytes: 4096, full: false}}), NOW);
    assert.deepStrictEqual([old[0].level, old[0].since], ['warn', null]);
    assert.match(old[0].cause, /^3 files of lines Logline refused are kept on the machine/);
});

test('lines that wait while nothing went for ten minutes are a problem; a machine that sends is not', function () {
    const silent = logline('ok', '2026-10-16T08:40:00Z', 10, 1000);
    silent.last_sent_at = '2026-10-16T08:45:00Z';
    assert.strictEqual(problems_from_logline('vps1', silent, NOW)[0].key, 'logline_silent:vps1');
    const sending = logline('ok', '2026-10-16T08:59:58Z', 10, 1000);
    sending.last_sent_at = '2026-10-16T08:59:59Z';
    assert.deepStrictEqual(problems_from_logline('vps1', sending, NOW), []);
});

test('a store near its cap is a problem, and one at its cap says collecting has stopped', function () {
    const near = problems_from_logline('vps1', logline('ok', null, 1, 850*1024*1024), NOW);
    assert.match(near[0].subject, /near the limit/);
    const full = problems_from_logline('vps1', logline('ok', null, 1, 1024*1024*1024), NOW);
    assert.match(full[0].subject, /stopped collecting/);
});

test('a machine that does not collect, or an agent that says nothing yet, has no Logline problem', function () {
    assert.deepStrictEqual(problems_from_logline('vps1', null, NOW), []);
    assert.deepStrictEqual(problems_from_logline('vps1', Object.assign(logline('500 down', null, 5, 10), {collecting: false}), NOW), []);
});

test('a problem shows once seen twice a check apart, is said when it shows, and again when it is gone', function () {
    const app = {log_lines: [], file_log: null, log_group: null, log_stdout_time: true, problems: new Map()};
    const item = {key: 'k', kind: 'remote', remote: 'vps1', subject: 'vps1 is offline', cause: 'its agent is not dialled in', fix: 'see it', since: null};
    problems_apply(app, [item], NOW);
    assert.strictEqual(app.problems.get('k').shown, false);
    assert.strictEqual(app.log_lines.length, 0);
    problems_apply(app, [item], NOW + 60*1000);
    assert.strictEqual(app.problems.get('k').shown, true);
    assert.match(app.log_lines[0], /\[problem_begin\] remote=vps1 subject="vps1 is offline"/);
    problems_apply(app, [], NOW + 120*1000);
    assert.strictEqual(app.problems.size, 0);
    assert.match(app.log_lines[1], /\[problem_end\] remote=vps1 subject="vps1 is offline" lasted=/);
});

test('a problem gone before it was seen twice is never said', function () {
    const app = {log_lines: [], file_log: null, log_group: null, log_stdout_time: true, problems: new Map()};
    problems_apply(app, [{key: 'k', kind: 'service', remote: null, subject: 'x does not answer', cause: 'refused', fix: 'restart it', since: null}], NOW);
    problems_apply(app, [], NOW + 60*1000);
    assert.strictEqual(app.log_lines.length, 0);
});

function container(id, name, state)
{
    return {Id: id, Names: [`/${name}`], State: state, Mounts: []};
}

function inspected(policy, status, code, error)
{
    return {HostConfig: {RestartPolicy: {Name: policy}}, State: {Status: status, ExitCode: code, Error: error, FinishedAt: '2026-10-16T05:52:16Z'}};
}

function logline(answer, oldest, lines, bytes)
{
    return {
        collecting: true,
        waiting: {lines, bytes, oldest},
        cap_bytes: 1024*1024*1024,
        last_sent_at: '2026-10-16T08:59:00Z',
        last_answer: answer,
    };
}
