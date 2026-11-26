const path = require('path');
const send_json = require('../helpers/send_json');
const sqlite_browse_serve = require('../helpers/sqlite_browse_serve');

// GET /api/v1/remotes/<name>/sqlite/<file>/browse
// GET /api/v1/remotes/<name>/sqlite/<file>/browse/collections
// GET /api/v1/remotes/<name>/sqlite/<file>/browse/documents (query)
// GET /api/v1/remotes/<name>/sqlite/<file>/browse/aggregate (query)
// A SQLite file of a machine, its data through the Data browser module, read by the machine's
// agent itself (sqlite_browse_serve). <file> is the file's path as one word of the address, its
// slashes encoded too (%2F). The owner's alone, as a database's data is: the manifest names no
// right a token may have.
async function handle_sqlite_browse(app, req, res, url, name, file, tail)
{
    const remote = app.remote_by_name[name];
    if (remote === undefined) {
        send_json(res, 404, {error: `no remote named ${JSON.stringify(name)}`});
        return;
    }
    if (remote.state.phase !== 'online') {
        send_json(res, 409, {error: `${name} is offline: ${path.posix.basename(file)} is read again when it is back`});
        return;
    }
    await sqlite_browse_serve(app, req, res, {remote, file, tail, query: url.searchParams});
}

module.exports = handle_sqlite_browse;
