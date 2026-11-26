const data_browser_serve = require('../../../../modules/data_browser/server/data_browser_serve');
const database_engines = require('../helpers/database_engines');
const database_script = require('../helpers/database_script');
const databases_read = require('../helpers/databases_read');
const docker_exec_connect = require('../helpers/docker_exec_connect');
const log_event = require('../helpers/log_event');
const mongodb_adapter = require('../../../../modules/data_browser/server/mongodb_adapter');
const mysql_adapter = require('../../../../modules/data_browser/server/mysql_adapter');
const postgresql_adapter = require('../../../../modules/data_browser/server/postgresql_adapter');
const send_json = require('../helpers/send_json');

// The engines the data browser reads, each its adapter given the way to run a script in the
// database as its own user
const ADAPTERS = {
    mongodb: mongodb_adapter,
    mysql: mysql_adapter,
    postgresql: postgresql_adapter,
};

// GET /api/v1/databases/<server>/<database>/browse
// GET /api/v1/databases/<server>/<database>/browse/collections
// GET /api/v1/databases/<server>/<database>/browse/documents (query)
// One database's data, through the Data browser module: what it asks runs inside the server's
// container, in that database, signed in as the user serviceman made for it, never root. The
// owner's alone, as the rest of a database is: the manifest names no right a token may have.
async function handle_database_browse(app, req, res, url, name, database, tail)
{
    const server = databases_read(app).servers.find(v => v.name === name);
    if (server === undefined) {
        send_json(res, 404, {error: `no database server called ${JSON.stringify(name)}`});
        return;
    }
    const engine = database_engines.find(v => v.value === server.engine);
    if (ADAPTERS[server.engine] === undefined) {
        send_json(res, 501, {error: `${name} is a ${engine.label}: its data is not browsed here, only a MongoDB's, a PostgreSQL's and a MySQL's`});
        return;
    }
    if (server.users[database] === undefined) {
        send_json(res, 404, {error: `${name} has no database ${JSON.stringify(database)} made by serviceman`});
        return;
    }
    const remote = app.remote_by_name[server.remote];
    if ((remote === undefined) || (remote.state.phase !== 'online')) {
        send_json(res, 409, {error: `${server.remote} is offline: ${database} is read again when it is back`});
        return;
    }
    if (server.phase !== 'up') {
        send_json(res, 409, {error: `${name} is not up: see its page`});
        return;
    }
    const connect = docker_exec_connect(app, remote);
    await data_browser_serve(req, res, {
        adapter: ADAPTERS[server.engine](v => database_script(connect, server, database, v)),
        about: {database, server: name, remote: server.remote, version: server.version, label: engine.label},
        tail,
        query: url.searchParams,
        log: function (event, fields) {
            log_event(app, event, Object.assign({database: name, name: database, remote: server.remote}, fields));
        },
    });
}

module.exports = handle_database_browse;
