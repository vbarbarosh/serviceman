const crypto = require('crypto');
const engine_exec = require('./engine_exec');
const engine_files_put = require('./engine_files_put');

// The client of each engine, run inside the server's container as the database's own user,
// never root: what the data browser asks runs with that user's rights, on that database alone.
// MongoDB's user is made in its database, which signs it in; its name and password are in the
// exec's env.
const CLIENTS = {
    mongodb: v => `mongosh --quiet --norc 'mongodb://127.0.0.1:27017/${v}' --eval 'void db.auth(process.env.SERVICEMAN_DB_USER, process.env.SERVICEMAN_DB_PASSWORD)' "$1"`,
};
const SUFFIXES = {mongodb: '.js'};

// A script run in one database as its own user, inside its server's container: the text goes in
// as a file of its own, removed when it has run; the user's name and password go in the exec's
// env, never on a command line. Answers with what it printed; a client that ends with an error
// throws what it said. `database` is one serviceman made, a name RE_DATABASE checked.
//
//     await database_script(connect, server, 'orders', 'print(db.getName())')   // 'orders\n'
function database_script(connect, server, database, script)
{
    const user = server.users[database];
    if ((user === undefined) || (CLIENTS[server.engine] === undefined)) {
        throw new Error(`${server.name} has no ${database} made by serviceman to run it in`);
    }
    return script_run(connect, server, database, user, script);
}

async function script_run(connect, server, database, user, script)
{
    const container = `serviceman-db-${server.name}`;
    const file = `/tmp/serviceman-${crypto.randomBytes(8).toString('hex')}${SUFFIXES[server.engine]}`;
    await engine_files_put(connect, container, '/tmp', [{name: file.slice('/tmp/'.length), bytes: Buffer.from(script)}]);
    const line = `${CLIENTS[server.engine](database)}; code=$?; rm -f "$1"; exit $code`;
    const said = await engine_exec(connect, container, ['sh', '-c', line, 'sh', file], [`SERVICEMAN_DB_USER=${user.user}`, `SERVICEMAN_DB_PASSWORD=${user.password}`]);
    if (said.code !== 0) {
        throw new Error(said.stderr.trim() || `${server.engine}'s client ended with ${said.code}`);
    }
    return said.stdout;
}

module.exports = database_script;
