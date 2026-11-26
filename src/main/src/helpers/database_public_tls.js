const databases_read = require('./databases_read');
const databases_write = require('./databases_write');
const log_event = require('./log_event');
const remote_addresses = require('./remote_addresses');
const tls_cert_make = require('./tls_cert_make');

// The certificate a database server's public port speaks TLS with: its own authority's, for
// every address its machine is reached at (remote_addresses), kept beside its passwords in
// data/databases.json. Made the first time it is asked for, and again when the machine is
// reached at an address the certificate does not name: a client then takes the new authority's
// file, said in the log as database_tls_made.
//
// Answers {cert, key} for the agent that listens, or null for a server not there or a machine
// whose addresses are not known yet.
function database_public_tls(app, name)
{
    const databases = databases_read(app);
    const server = databases.servers.find(v => v.name === name);
    if (server === undefined) {
        return null;
    }
    const remote = app.remote_by_name[server.remote];
    const at = (remote === undefined) ? [] : remote_addresses(remote).all;
    const kept = server.tls;
    if ((kept !== undefined) && at.every(v => kept.at.includes(v))) {
        return {cert: kept.cert, key: kept.key};
    }
    const named = (kept === undefined) ? at : [...new Set(kept.at.concat(at))];
    // A machine whose addresses are not known yet: nothing to name
    if (named.length === 0) {
        return null;
    }
    const made = tls_cert_make(name, named);
    server.tls = {at: named, ca: made.ca, cert: made.cert, key: made.key};
    databases_write(app, databases);
    log_event(app, 'database_tls_made', {database: name, at: named.join(', ')});
    return {cert: made.cert, key: made.key};
}

module.exports = database_public_tls;
