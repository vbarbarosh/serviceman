const database_root_hold = require('./database_root_hold');
const databases_read = require('./databases_read');
const databases_write = require('./databases_write');
const docker_exec_connect = require('./docker_exec_connect');
const log_event = require('./log_event');

// A MongoDB brought up before its root was held to its container, held now (database_root_hold),
// once: it is kept as `root_held`, which a server brought up since has from the start. A server
// of another engine, one not up, or one whose machine is away is not asked.
async function database_root_held(app, name)
{
    const server = databases_read(app).servers.find(v => v.name === name);
    const remote = (server === undefined) ? undefined : app.remote_by_name[server.remote];
    if ((server === undefined) || (server.engine !== 'mongodb') || (server.root_held === true) || (server.phase !== 'up') || (remote === undefined) || (remote.state.phase !== 'online')) {
        return;
    }
    await database_root_hold(docker_exec_connect(app, remote), server);
    const databases = databases_read(app);
    const kept = databases.servers.find(v => v.name === name);
    if (kept !== undefined) {
        kept.root_held = true;
        databases_write(app, databases);
    }
    log_event(app, 'database_root_held', {database: name, remote: server.remote});
}

module.exports = database_root_held;
