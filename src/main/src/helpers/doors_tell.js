const doors_table = require('./doors_table');
const log_event = require('./log_event');
const remote_call = require('./remote_call');

// Each connected machine is sent its door table when it differs from the one it said it
// serves: at its hello, after the config changes, and on the minute — a machine that comes
// online changes its peers' tables too. What goes wrong is said once per reason, not per try.
async function doors_tell(app)
{
    for (const remote of app.remotes) {
        if ((remote.state.phase !== 'online') || (remote.state.resources === null) || (remote.state.resources.doors === undefined)) {
            continue;
        }
        const table = doors_table(app, remote);
        remote.state.doors_wanted = table.version;
        // Told already, or on its way: two hellos at once must not send one table twice
        if ((remote.state.doors_told === table.version) || (remote.state.doors_sending === table.version)) {
            continue;
        }
        remote.state.doors_sending = table.version;
        try {
            await remote_call(app, remote, 'doors_set', {table});
            remote.state.doors_told = table.version;
            remote.state.doors_error = null;
            log_event(app, 'doors_told', {remote: remote.name, version: table.version, names: Object.keys(table.names).length, peers: Object.keys(table.peers).length});
        }
        catch (error) {
            if (remote.state.doors_error !== error.message) {
                log_event(app, 'doors_tell_error', {remote: remote.name, reason: error.message});
            }
            remote.state.doors_error = error.message;
        }
        finally {
            remote.state.doors_sending = null;
        }
    }
}

module.exports = doors_tell;
