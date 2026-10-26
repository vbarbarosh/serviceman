const log_event = require('./log_event');
const remote_call = require('./remote_call');
const remote_can = require('./remote_can');
const shared_read = require('./shared_read');
const shared_table = require('./shared_table');
const shared_write = require('./shared_write');

// Mounting is root's work over there, and the first mount fetches juicefs: minutes, not seconds
const APPLY_TIMEOUT_MS = 600000;

// Each connected machine that has shared folders mounted, or had, is told its table when it
// differs from the last one it took: at its hello and after every change. What it answers is
// kept for the page. What goes wrong is said once per reason, not per try.
async function shared_tell(app)
{
    const shared = shared_read(app);
    const names = new Set(shared.mounts.map(v => v.remote).concat(shared.told));
    for (const name of names) {
        const remote = app.remote_by_name[name];
        if ((remote === undefined) || (remote.state.phase !== 'online') || (remote_can(remote, 'shared') === false) || (remote_can(remote, 'root') === false)) {
            continue;
        }
        const table = shared_table(shared, name);
        // Told already, or on its way: two hellos at once must not send one table twice
        if ((remote.state.shared_told === table.version) || (remote.state.shared_sending === table.version)) {
            continue;
        }
        remote.state.shared_sending = table.version;
        try {
            const answer = await remote_call(app, remote, 'shared', {action: 'apply', table}, APPLY_TIMEOUT_MS);
            if (answer.ok === false) {
                throw new Error(answer.error);
            }
            remote.state.shared_told = table.version;
            remote.state.shared_answer = answer;
            remote.state.shared_error = null;
            told_mark(app, name, table.mounts.length > 0);
            log_event(app, 'shared_told', {remote: name, version: table.version, mounts: table.mounts.length, mounted: answer.items.filter(v => v.state === 'mounted').length});
        }
        catch (error) {
            if (remote.state.shared_error !== error.message) {
                log_event(app, 'shared_tell_error', {remote: name, reason: error.message});
            }
            remote.state.shared_error = error.message;
        }
        finally {
            remote.state.shared_sending = null;
        }
    }
}

// A machine given mounts is one to tell again when its last mount goes, and only until then
function told_mark(app, name, has_mounts)
{
    const shared = shared_read(app);
    const told = shared.told.filter(v => v !== name);
    if (has_mounts) {
        told.push(name);
    }
    if (JSON.stringify(told) !== JSON.stringify(shared.told)) {
        shared.told = told;
        shared_write(app, shared);
    }
}

module.exports = shared_tell;
