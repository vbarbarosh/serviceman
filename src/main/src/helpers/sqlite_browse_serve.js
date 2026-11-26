const data_browser_serve = require('../../../../modules/data_browser/server/data_browser_serve');
const log_event = require('./log_event');
const node_sqlite_refusal_of = require('../../../helpers/node_sqlite_refusal_of');
const path = require('path');
const remote_call = require('./remote_call');
const remote_can = require('./remote_can');
const send_json = require('./send_json');
const sqlite_adapter = require('../../../../modules/data_browser/server/sqlite_adapter');

// What a read of the file may take on top of its own time: its reader started, and the answer's
// way back over the link
const CALL_SPARE_MS = 15000;
// The longest path a machine's file has, as Linux's PATH_MAX
const PATH_MOST = 4096;

// One SQLite file of a machine that is online, its data through the Data browser module, under
// whatever base the host mounts it at: the machine's agent reads it itself, with its Node's own
// node:sqlite, read only (agent_sqlite_read). `file` is its path, read as the File Manager's
// paths are, ~ the home of the agent's user. serviceman mounts it under the machine
// (handle_sqlite_browse), module-host under this computer.
//
//     options = {remote, file, tail, query}
//
//     GET <base>               {engine: 'sqlite', database, remote, path, label, size, mtime_ms}:
//                              the file opened as SQLite, or why it is not (404, 400, 409…)
//     GET <base>/collections   the rest, as data_browser_serve answers them
async function sqlite_browse_serve(app, req, res, options)
{
    const remote = options.remote;
    const file = options.file;
    if ((file === '') || (file.length > PATH_MOST) || file.includes('\0')) {
        send_json(res, 400, {error: `the address names a file by its path, of at most ${PATH_MOST} characters`});
        return;
    }
    if (remote_can(remote, 'sqlite_read') === false) {
        send_json(res, 501, {error: refusal_of(remote)});
        return;
    }
    const adapter = sqlite_adapter(v => remote_call(app, remote, 'sqlite_read', Object.assign({path: file}, v), v.ms + CALL_SPARE_MS));
    const about = {database: path.posix.basename(file), remote: remote.name, path: file, label: 'SQLite', size: null, mtime_ms: null};
    // GET <base>: the file as its head shows it, how big and how old, once it opened as SQLite
    if ((options.tail === '') || (options.tail === '/')) {
        try {
            Object.assign(about, await adapter.file());
        }
        catch (error) {
            send_json(res, (error.status === undefined) ? 502 : error.status, {error: error.message});
            return;
        }
    }
    await data_browser_serve(req, res, {
        adapter,
        about,
        tail: options.tail,
        query: options.query,
        log: function (event, fields) {
            log_event(app, event, Object.assign({remote: remote.name, file}, fields));
        },
    });
}

// Why this machine's agent reads no SQLite file: its Node, as it said it, or an agent from before
// they were read
function refusal_of(remote)
{
    const refusal = node_sqlite_refusal_of((remote.state.resources === null) ? null : remote.state.resources.node);
    if (refusal !== null) {
        return `the agent on ${remote.name} runs ${refusal}`;
    }
    return `the agent on ${remote.name} is from before SQLite files are read: it updates itself, and its page says how`;
}

module.exports = sqlite_browse_serve;
