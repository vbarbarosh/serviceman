const apt_lane = require('./apt_lane');
const apt_said = require('./apt_said');
const log_event = require('./log_event');
const problems_check = require('./problems_check');
const remote_call = require('./remote_call');
const remote_containers_restore = require('./remote_containers_restore');
const remote_containers_running = require('./remote_containers_running');
const stream_open = require('./stream_open');
const streams_of = require('./streams_of');

// Installing everything a machine is behind on is a job of minutes, sometimes many
const APT_TIMEOUT_MS = 3600000;

// How a run that ended is said at the end of its stream
const STREAM_ENDS = {ok: 'done', error: 'failed', cancelled: 'cancelled'};

// Installs what is waiting on one machine: what Install them on its page does, and what the
// Remotes list does for each machine it was asked for. The answer is the end of the run, once
// the containers that ran before it run again; the run itself is on the remote's state, for
// the page to read while it goes.
async function apt_run(app, remote)
{
    // Its lines are said in a stream as they come too, for the page to follow rather than ask
    const stream = stream_open(app, {title: 'Installing the updates', base: `/api/v1/remotes/${encodeURIComponent(remote.name)}/packages`, command: 'upgrade'});
    remote.state.apt = {phase: 'running', lines: [], started_at: Date.now(), ended_at: null, error: null, containers: null, stream: stream.id, url: stream.url};
    log_event(app, 'apt_begin', {remote: remote.name});
    // What runs now has to run after: an upgrade of Docker restarts every container, and the
    // ones Docker does not bring back are started again once it is over
    let before = null;
    try {
        before = await remote_containers_running(app, remote);
    }
    catch (error) {
        log_event(app, 'apt_containers_unknown', {remote: remote.name, reason: error.message});
    }
    let phase = 'error';
    let reason = null;
    try {
        const answer = await remote_call(app, remote, 'apt_upgrade', {service: apt_lane}, APT_TIMEOUT_MS);
        phase = answer.cancelled ? 'cancelled' : (answer.ok ? 'ok' : 'error');
        reason = answer.ok ? null : last_line_of(answer);
    }
    catch (error) {
        reason = error.message;
    }
    try {
        await apt_ended(app, remote, before, phase, reason);
    }
    catch (error) {
        log_event(app, 'apt_containers_error', {remote: remote.name, reason: error.message});
    }
}

async function apt_ended(app, remote, before, phase, error)
{
    const run = remote.state.apt;
    if (before !== null) {
        apt_said(app, remote, 'serviceman: the upgrade is over; every container that ran before it is to run again');
        run.containers = await remote_containers_restore(app, remote, before);
        for (const name of run.containers.started) {
            apt_said(app, remote, `serviceman: ${name} had stopped, and is started again`);
        }
        for (const item of run.containers.down) {
            apt_said(app, remote, `serviceman: ${item.name} ran before the upgrade and cannot start now: ${item.reason}`);
        }
        log_event(app, (run.containers.down.length === 0) ? 'apt_containers_ok' : 'apt_containers_down', {remote: remote.name, ran: before.length, started: run.containers.started, down: run.containers.down.map(v => v.name)});
    }
    run.phase = phase;
    run.ended_at = Date.now();
    run.error = error;
    const stream = streams_of(app).get(run.stream);
    if (stream !== undefined) {
        stream.end({end: STREAM_ENDS[phase], said: (error === null) ? 'installed' : error});
    }
    log_event(app, (phase === 'ok') ? 'apt_end_ok' : 'apt_end_error', {remote: remote.name, lines: run.lines.length, reason: (error === null) ? undefined : error});
    // What the upgrade left wrong is on the page now, not at the next look a minute away
    problems_check(app).catch(function (error) {
        log_event(app, 'problems_check_error', {reason: error.message});
    });
    // What is waiting has just changed, and the page is looking at it: the machine is asked
    // again now rather than at the next heartbeat half a minute from here
    const promise = remote_call(app, remote, 'stats');
    promise.then(function (stats) {
        remote.state.stats = stats;
    }, function () {
        // The link went with the run; the next heartbeat says what is true
    });
}

function last_line_of(answer)
{
    const said = `${answer.stderr || ''}\n${answer.stdout || ''}`.trim().split('\n').filter(v => v.trim() !== '');
    return (said.length === 0) ? `apt-get ended with ${answer.code}` : said[said.length - 1];
}

module.exports = apt_run;
