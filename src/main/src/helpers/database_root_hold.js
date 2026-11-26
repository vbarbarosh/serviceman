const database_sql = require('./database_sql');

// Where MongoDB's root may sign in from: the container's own loopback, where serviceman runs its
// scripts (database_sql) and its ready check, and nowhere else
const ROOT_HOLD = 'db.getSiblingDB("admin").updateUser("root", {authenticationRestrictions: [{clientSource: ["127.0.0.1", "::1"]}]});\n';

// A MongoDB's root, its admin, held to its own container: through its port, a forward of it or a
// public port, only a database's own user signs in, whoever has root's password. serviceman's own
// scripts sign in as root from inside the container, and go on doing so. Run as root itself; a
// server of another engine is left as it is.
//
//     server    {name, engine, root} as databases_read keeps it
async function database_root_hold(connect, server)
{
    if (server.engine !== 'mongodb') {
        return;
    }
    await database_sql(connect, server, ROOT_HOLD);
}

module.exports = database_root_hold;
