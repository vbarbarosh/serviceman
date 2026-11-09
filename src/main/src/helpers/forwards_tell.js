const log_event = require('./log_event');
const remote_call = require('./remote_call');
const remote_can = require('./remote_can');

// Each connected machine is told the forwards it listens for, when they differ from what it
// was told on this link — an empty list too, for an agent that outlived its last link may still
// hold one taken out of the config while it was away: at its hello, after the config changes, and on the minute while one of
// them could not listen — a socket file another program held may be free by now.
//
// It is called and left to itself, at a hello and on the minute, so nothing may come out of it:
// what a machine said that cannot be read is a line in the log, where thrown from here it
// would end the process.
async function forwards_tell(app)
{
    try {
        await tell(app);
    }
    catch (error) {
        log_event(app, 'forwards_tell_error', {reason: error.message});
    }
}

async function tell(app)
{
    for (const remote of app.remotes) {
        const state = remote.state;
        if ((state.phase !== 'online') || (remote_can(remote, 'forwards') === false)) {
            continue;
        }
        const forwards = forwards_of(app, remote.name);
        const key = JSON.stringify(forwards);
        const failed = (state.forwards_said !== null) && Object.values(state.forwards_said).some(v => v.error !== null);
        if (((state.forwards_told === key) && (failed === false)) || (state.forwards_sending !== null)) {
            continue;
        }
        state.forwards_sending = key;
        try {
            const said = said_checked(await remote_call(app, remote, 'forwards_set', {forwards}));
            state.forwards_told = key;
            state.forwards_said = said;
            state.forwards_error = null;
            log_event(app, 'forwards_told', {remote: remote.name, forwards: forwards.length, failed: Object.keys(said).filter(v => said[v].error !== null).join(',')});
        }
        catch (error) {
            if (state.forwards_error !== error.message) {
                log_event(app, 'forwards_tell_error', {remote: remote.name, reason: error.message});
            }
            state.forwards_error = error.message;
        }
        finally {
            state.forwards_sending = null;
        }
    }
}

// A machine's answer as it should be, a word about each forward by its label, or a refusal:
// the answer is kept and read again at the next telling, and the page reads it too
function said_checked(said)
{
    const fine = (said !== null) && (typeof said === 'object') && (Array.isArray(said) === false) && Object.values(said).every(v => (v !== null) && (typeof v === 'object'));
    if (fine === false) {
        throw new Error('the machine answered forwards_set with what is no answer');
    }
    return said;
}

// What one machine listens for: the `to` of each forward that is on and shows up there, and
// nothing about where it comes from
function forwards_of(app, name)
{
    const out = [];
    for (const item of app.config.forwards) {
        if ((item.off === false) && (item.to.remote === name)) {
            out.push((item.to.socket === null) ? {name: item.label, port: item.to.port} : {name: item.label, socket: item.to.socket});
        }
    }
    return out;
}

module.exports = forwards_tell;
