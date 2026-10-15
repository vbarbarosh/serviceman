const log_event = require('./log_event');
const remote_call = require('./remote_call');

// Each connected machine is told the forwards it listens for, when they differ from what it
// was told on this link — an empty list too, for an agent that outlived its last link may still
// hold one taken out of the config while it was away: at its hello, after the config changes, and on the minute while one of
// them could not listen — a socket file another program held may be free by now.
async function forwards_tell(app)
{
    for (const remote of app.remotes) {
        const state = remote.state;
        if ((state.phase !== 'online') || (state.resources === null) || (state.resources.can === undefined) || (state.resources.can.includes('forwards') === false)) {
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
            const said = await remote_call(app, remote, 'forwards_set', {forwards});
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

// What one machine listens for: its end of each forward that is on, and nothing about the other
function forwards_of(app, name)
{
    const out = [];
    for (const item of app.config.forwards) {
        if ((item.off === false) && (item.from.remote === name)) {
            out.push((item.from.socket === null) ? {name: item.name, port: item.from.port} : {name: item.name, socket: item.from.socket});
        }
    }
    return out;
}

module.exports = forwards_tell;
