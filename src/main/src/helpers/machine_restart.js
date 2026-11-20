const log_event = require('./log_event');
const problems_check = require('./problems_check');
const remote_call = require('./remote_call');
const security_check = require('./security_check');

// How long the agent has to answer that the machine is going down
const ASK_TIMEOUT_MS = 20000;
// A boot this long before the ask is the same boot: the clocks of two machines differ a little
const BOOT_SLACK_MS = 5000;
// The phases a restart is not over in: another machine waits until none is in them
const UNDERWAY = ['asking', 'going', 'down', 'back'];

// One machine restarted from the page, and followed until it is back: its root half asked
// (asking), its answer had (going), its link gone (down), its agent dialled in again on a new
// boot (back), and a Security look made at once, so a problem the restart mends goes with it
// (done). A machine still up on the same boot three minutes on, or away ten, is an error that
// says so, as is a refusal. One machine at a time: the next waits until the last is back, so
// two that serve the same thing are never down together. Kept in the machine's state for as
// long as serviceman runs; its view is the status's.
//
//     remote.state.restart   {phase, asked_at, by, down_at, back_at, ended_at, error}, or null
async function machine_restart(app, remote)
{
    const restart = {phase: 'asking', asked_at: Date.now(), by: null, down_at: null, back_at: null, ended_at: null, error: null};
    timer_clear(remote);
    remote.state.restart = restart;
    log_event(app, 'machine_restart_asked', {remote: remote.name});
    let answer;
    try {
        answer = await remote_call(app, remote, 'machine_restart', {}, ASK_TIMEOUT_MS);
    }
    catch (error) {
        ended(app, remote, error.message);
        throw error;
    }
    // The link may have gone already, with the answer still on its way
    if (restart.phase === 'asking') {
        restart.phase = 'going';
    }
    restart.by = String(answer.by);
    log_event(app, 'machine_restart_going', {remote: remote.name, by: restart.by});
    timer_set(remote, machine_restart.go_down_ms, function () {
        if (restart.phase === 'going') {
            ended(app, remote, `${remote.name} is still up on the same boot ${Math.round(machine_restart.go_down_ms/60000)} minutes after it was asked to restart: its agent's log there says why (machine_restart_error)`);
        }
    });
    return machine_restart.view(remote);
}

// Its link went: one asked to restart is down now, and has ten minutes to dial in again
machine_restart.offline = function (app, remote) {
    const restart = remote.state.restart;
    if ((restart === null) || ((restart.phase !== 'asking') && (restart.phase !== 'going'))) {
        return;
    }
    restart.phase = 'down';
    restart.down_at = Date.now();
    log_event(app, 'machine_restart_down', {remote: remote.name});
    timer_set(remote, machine_restart.come_back_ms, function () {
        if (restart.phase === 'down') {
            ended(app, remote, `${remote.name} went down to restart and has not dialled in for ${Math.round(machine_restart.come_back_ms/60000)} minutes: its console says why, or its provider's page`);
        }
    });
};

// Its agent said hello: on a boot after the ask, the machine is back, and is looked at at once.
// The same boot is a link that dropped on its own: the restart is still to come.
machine_restart.online = function (app, remote, stats) {
    const restart = remote.state.restart;
    if ((restart === null) || ((restart.phase !== 'going') && (restart.phase !== 'down'))) {
        return;
    }
    const uptime = ((stats === null) || (stats === undefined)) ? null : stats.uptime_ms;
    const booted = (typeof uptime === 'number') && (Date.now() - uptime > restart.asked_at - BOOT_SLACK_MS);
    if (booted === false) {
        restart.phase = 'going';
        return;
    }
    timer_clear(remote);
    restart.phase = 'back';
    restart.back_at = Date.now();
    restart.down_at = (restart.down_at === null) ? restart.back_at : restart.down_at;
    log_event(app, 'machine_restart_back', {remote: remote.name, down_ms: restart.back_at - restart.down_at});
    const promise = look(app, remote);
    promise.then(function () {
        if (remote.state.restart === restart) {
            restart.phase = 'done';
            restart.ended_at = Date.now();
        }
    });
};

// How long a machine asked to restart may stay up on the same boot before that is said, and how
// long one that went down may stay away; a test makes them short
machine_restart.go_down_ms = 3*60*1000;
machine_restart.come_back_ms = 10*60*1000;

// The machine whose restart is underway, by name, or null
machine_restart.busy = function (app) {
    const found = app.remotes.find(v => (v.state.restart !== null) && UNDERWAY.includes(v.state.restart.phase));
    return (found === undefined) ? null : found.name;
};

machine_restart.view = function (remote) {
    const restart = remote.state.restart;
    return (restart === null) ? null : Object.assign({}, restart);
};

// The Security look that sees the new kernel, then the problems again, so a card it mends goes
// now rather than at the next minute; neither failing holds the restart up, each is logged
async function look(app, remote)
{
    try {
        await security_check.one(app, remote);
        await problems_check(app);
    }
    catch (error) {
        log_event(app, 'machine_restart_look_error', {remote: remote.name, reason: error.message});
    }
}

function ended(app, remote, error)
{
    timer_clear(remote);
    const restart = remote.state.restart;
    Object.assign(restart, {phase: 'error', ended_at: Date.now(), error});
    log_event(app, 'machine_restart_error', {remote: remote.name, reason: error});
}

function timer_set(remote, ms, fn)
{
    timer_clear(remote);
    remote.state.restart_timer = setTimeout(fn, ms);
    remote.state.restart_timer.unref();
}

function timer_clear(remote)
{
    if ((remote.state.restart_timer !== undefined) && (remote.state.restart_timer !== null)) {
        clearTimeout(remote.state.restart_timer);
    }
    remote.state.restart_timer = null;
}

module.exports = machine_restart;
