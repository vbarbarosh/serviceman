const database_engines = require('./database_engines');

// A database's URL as its own user reaches it from a machine: by its container's name on the
// databases' network from a container of the server's machine (inside), at its port on
// 127.0.0.1 from a program there, and from a program on another machine at the port the
// server's forward listens on there (database_forwards_put). A CouchDB is given as its admin,
// with no database in its URL. Throws why it is not reached so: the server not up, no user
// serviceman made, its port not brought to that machine, its forward there set aside, or a
// container there, which has a 127.0.0.1 of its own.
//
//     server    {name, engine, remote, port, phase, users} as databases_read keeps it
//     database  the database's name, its user's key in `users`
//     remote    the name of the machine it is reached from
//
//     database_url(app, server, 'orders', 'vps2', false)  // mongodb://orders:<password>@127.0.0.1:27017/orders
function database_url(app, server, database, remote, inside)
{
    const engine = database_engines.find(v => v.value === server.engine);
    const host = host_of(app, server, remote, inside, engine);
    if (server.phase !== 'up') {
        throw new Error(`${server.name} is not up: see Databases`);
    }
    const user = server.users[database];
    if (user === undefined) {
        throw new Error(`${server.name} has no database ${database} made by serviceman`);
    }
    if (server.engine === 'couchdb') {
        return `${engine.scheme}://${user.user}:${user.password}@${host}`;
    }
    return `${engine.scheme}://${user.user}:${user.password}@${host}/${database}`;
}

// Where it is reached from that machine, host:port
function host_of(app, server, remote, inside, engine)
{
    if (server.remote === remote) {
        return inside ? `serviceman-db-${server.name}:${engine.port}` : `127.0.0.1:${server.port}`;
    }
    // The first of its forwards that listens on a port there; one set aside only when no other does
    const there = app.config.forwards.filter(v => (v.database === server.name) && (v.to.here === false) && (v.to.remote === remote) && (v.to.port !== null));
    const forward = there.find(v => v.off === false) || there[0];
    if (forward === undefined) {
        throw new Error(`${server.name} is on ${server.remote}, and its port is not brought to ${remote}: bring it there on its page in Databases`);
    }
    if (forward.off) {
        throw new Error(`${server.name} is on ${server.remote}, and its forward to ${remote} is set aside: turn it on in Forwards`);
    }
    if (inside) {
        throw new Error(`${server.name} is on ${server.remote}, its port brought to ${remote}'s 127.0.0.1, which a container does not reach: a program or an app folder there does`);
    }
    return `127.0.0.1:${forward.to.port}`;
}

module.exports = database_url;
