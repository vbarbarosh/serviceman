const database_forwards_put = require('./database_forwards_put');
const database_port_read = require('./database_port_read');
const databases_read = require('./databases_read');
const databases_write = require('./databases_write');
const docker_exec_connect = require('./docker_exec_connect');
const log_event = require('./log_event');

// A database server's port read again from docker, kept when it moved, and its forwards brought
// from it: docker picks the port as the container starts, and starts it on another after the
// machine or its docker restarted. Answers true once a port was read, false while the container
// does not run (not started again yet); a server that is not up, or whose machine is away, is
// not asked.
async function database_port_follow(app, name)
{
    const server = databases_read(app).servers.find(v => v.name === name);
    const remote = (server === undefined) ? undefined : app.remote_by_name[server.remote];
    if ((server === undefined) || (server.phase !== 'up') || (remote === undefined) || (remote.state.phase !== 'online')) {
        return false;
    }
    const port = await database_port_read(docker_exec_connect(app, remote), server);
    if (port === null) {
        return false;
    }
    if (port !== server.port) {
        const databases = databases_read(app);
        const kept = databases.servers.find(v => v.name === name);
        if (kept !== undefined) {
            kept.port = port;
            databases_write(app, databases);
        }
        log_event(app, 'database_port_moved', {database: name, remote: server.remote, from: server.port, to: port});
    }
    const away = app.config.forwards.filter(v => (v.database === name) && ((v.from.remote !== server.remote) || (v.from.port !== port)));
    if (away.length > 0) {
        await database_forwards_put(app, {name, remote: server.remote, port}, null);
        log_event(app, 'database_forwards_follow', {database: name, remote: server.remote, port, forwards: away.map(v => v.label).join(', ')});
    }
    return true;
}

module.exports = database_port_follow;
