const database_engines = require('./database_engines');
const remote_addresses = require('./remote_addresses');

// A database's URL through its server's public port, as a client anywhere reaches it: its
// machine's public address (remote_addresses) at the port the public port listens on, its own
// user and password. With TLS, the client checks the server against its authority's file,
// fetched from the database's page and kept beside the client as <server>-ca.pem. Throws why it
// is not reached so: the server not up, no user serviceman made, no public port, one set aside,
// or a machine with no public address known.
//
//     database_public_url(app, server, 'orders')
//     // mongodb://orders:<password>@203.0.113.5:27017/orders?tls=true&tlsCAFile=mongodb-1-ca.pem
function database_public_url(app, server, database)
{
    const engine = database_engines.find(v => v.value === server.engine);
    if (server.phase !== 'up') {
        throw new Error(`${server.name} is not up: see Databases`);
    }
    const user = server.users[database];
    if (user === undefined) {
        throw new Error(`${server.name} has no database ${database} made by serviceman`);
    }
    const forward = app.config.forwards.find(v => (v.database === server.name) && (v.to.host === '0.0.0.0'));
    if (forward === undefined) {
        throw new Error(`${server.name} has no public port: open one on its page in Databases`);
    }
    if (forward.off) {
        throw new Error(`${server.name}'s public port is set aside: turn it on in Forwards`);
    }
    const remote = app.remote_by_name[server.remote];
    const address = (remote === undefined) ? null : remote_addresses(remote).public;
    if (address === null) {
        throw new Error(`${server.remote} has no public address serviceman knows: its agent says none, and it dials in from a private one`);
    }
    const host = address.includes(':') ? `[${address}]` : address;
    const query = forward.tls ? `?tls=true&tlsCAFile=${server.name}-ca.pem` : '';
    return `${engine.scheme}://${user.user}:${user.password}@${host}:${forward.to.port}/${database}${query}`;
}

module.exports = database_public_url;
