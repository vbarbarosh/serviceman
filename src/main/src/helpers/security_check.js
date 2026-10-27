const log_event = require('./log_event');
const security_of_remote = require('./security_of_remote');

// How often each machine is looked over again
const EVERY_MS = 60*60*1000;

// The Security page's looks at the machines: each connected one once an hour, once as soon as
// it connects, and all of them at once when asked (Check again). One look at a machine at a
// time: one that is being looked at is not asked again. What a look found stays until the next
// one has found something. Answers the machines it started a look at.
//
//     force   true: every connected machine now, whatever its last look
function security_check(app, force)
{
    const now = Date.now();
    const out = [];
    for (const remote of app.remotes) {
        const state = remote.state;
        // What it can be asked comes with its first status: before it, it is not looked at yet
        if ((state.phase !== 'online') || (state.resources === null) || app.security.running.has(remote.name)) {
            continue;
        }
        const last = app.security.seen.get(remote.name);
        if ((force === false) && (last !== undefined) && (last.at >= state.connected_at) && (now - last.at < EVERY_MS)) {
            continue;
        }
        out.push(remote.name);
        app.security.running.set(remote.name, look(app, remote));
    }
    return out;
}

// One machine looked at again now, after a look going on there ends: what a click mended shows
// in the next look, never in one that read the machine before it
security_check.one = async function (app, remote) {
    const going = app.security.running.get(remote.name);
    if (going !== undefined) {
        await going;
    }
    // One started meanwhile read the machine after the mend: that one is waited for
    const again = app.security.running.get(remote.name);
    if (again !== undefined) {
        await again;
        return;
    }
    if (remote.state.phase !== 'online') {
        return;
    }
    const promise = look(app, remote);
    app.security.running.set(remote.name, promise);
    await promise;
};

async function look(app, remote)
{
    const name = remote.name;
    try {
        const seen = await security_of_remote(app, remote);
        app.security.seen.set(name, seen);
        const skipped = seen.knocked.skipped;
        log_event(app, 'security_checked', {remote: name, ports: seen.rows.length, knocked: seen.rows.filter(v => v.knock !== null).length, answered: seen.rows.filter(v => v.knock === 'answered').length, not_knocked: (skipped === null) ? undefined : skipped});
    }
    catch (error) {
        log_event(app, 'security_check_error', {remote: name, reason: error.message});
        app.security.seen.set(name, {at: Date.now(), error: error.message});
    }
    finally {
        app.security.running.delete(name);
    }
}

module.exports = security_check;
