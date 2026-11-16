const log_event = require('./log_event');
const remote_call = require('./remote_call');
const remote_can = require('./remote_can');

// Each connected machine is told the mounts it makes, and answers where each one stands: at its
// hello, after the config changes, and on the minute, when a mount whose sshfs died or whose path
// was not free is tried again and the page hears about it. An empty list is told too: an agent
// may still hold a mount taken out of the config while it was away.
//
// It is called and left to itself, so nothing may come out of it: what a machine said that
// cannot be read is a line in the log, where thrown from here it would end the process.
async function mounts_tell(app)
{
    try {
        await tell(app);
    }
    catch (error) {
        log_event(app, 'mounts_tell_error', {reason: error.message});
    }
}

async function tell(app)
{
    for (const remote of app.remotes) {
        const state = remote.state;
        if ((state.phase !== 'online') || (remote_can(remote, 'mounts') === false) || (state.mounts_sending !== null)) {
            continue;
        }
        const mounts = mounts_of(app, remote.name);
        // A machine that never had a mount, and has none now, is not asked about it every minute
        if ((mounts.length === 0) && (state.mounts_said === null)) {
            continue;
        }
        state.mounts_sending = JSON.stringify(mounts);
        try {
            const said = said_checked(await remote_call(app, remote, 'mounts_set', {mounts}));
            const before = state.mounts_said;
            state.mounts_said = said;
            state.mounts_said_at = Date.now();
            state.mounts_error = null;
            const words = said.items.map(v => `${v.label}: ${v.state}`).join(', ');
            if ((before === null) || (before.items.map(v => `${v.label}: ${v.state}`).join(', ') !== words)) {
                log_event(app, 'mounts_told', {remote: remote.name, mounts: mounts.length, states: words});
            }
        }
        catch (error) {
            if (state.mounts_error !== error.message) {
                log_event(app, 'mounts_tell_error', {remote: remote.name, reason: error.message});
            }
            state.mounts_error = error.message;
        }
        finally {
            state.mounts_sending = null;
        }
    }
}

// A machine's answer as it should be: whether it has a root half, a word about each mount, and
// what it still holds that the table no longer has
function said_checked(said)
{
    const fine = (said !== null) && (typeof said === 'object') && Array.isArray(said.items) && said.items.every(v => (v !== null) && (typeof v === 'object') && (typeof v.label === 'string'));
    if (fine === false) {
        throw new Error('the machine answered mounts_set with what is no answer');
    }
    return {root: said.root === true, items: said.items, leaving: Array.isArray(said.leaving) ? said.leaving : []};
}

// What one machine mounts: the `to` of each mount that is on and is there, and nothing about
// where the folder comes from
function mounts_of(app, name)
{
    const out = [];
    for (const item of app.config.mounts) {
        if ((item.off === false) && (item.to.remote === name)) {
            out.push({name: item.label, path: item.to.path, mode: item.mode});
        }
    }
    return out;
}

module.exports = mounts_tell;
