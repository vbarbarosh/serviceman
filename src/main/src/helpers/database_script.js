const crypto = require('crypto');
const engine_exec = require('./engine_exec');
const engine_files_put = require('./engine_files_put');

// The client of each engine, run inside the server's container as the database's own user,
// never root: what the data browser asks runs with that user's rights, on that database alone.
// Its name is in the exec's env, and so is its password, in the variable the client reads one
// from; mongosh reads none, so its script signs in with SERVICEMAN_DB_PASSWORD first. psql and
// mysql connect over 127.0.0.1, where the user signs in with its password (in PostgreSQL's
// image, its socket trusts anyone).
//
// A MySQL script runs twice: first as a table with --column-type-info and @serviceman_types
// set, for the column types of its result, which nothing else the client prints says; then as
// XML, which tells NULL from the word NULL, for its rows (mysql_adapter).
const CLIENTS = {
    mongodb: {
        line: v => `mongosh --quiet --norc 'mongodb://127.0.0.1:27017/${v}' --eval 'void db.auth(process.env.SERVICEMAN_DB_USER, process.env.SERVICEMAN_DB_PASSWORD)' "$1"`,
        suffix: '.js',
        password_env: 'SERVICEMAN_DB_PASSWORD',
    },
    postgresql: {
        line: v => `psql -X -q -At -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$SERVICEMAN_DB_USER" -d '${v}' -f "$1"`,
        suffix: '.sql',
        password_env: 'PGPASSWORD',
    },
    mysql: {
        line: v => `mysql ${mysql_options(v)} -t --column-type-info --init-command='SET @serviceman_types = 1' < "$1" && mysql ${mysql_options(v)} --xml < "$1"`,
        suffix: '.sql',
        password_env: 'MYSQL_PWD',
    },
};

// A script run in one database as its own user, inside its server's container: the text goes in
// as a file of its own, removed when it has run; the user's name and password go in the exec's
// env, never on a command line. Answers with what it printed; a client that ends with an error
// throws what it said, with what it printed before it in `stdout`. `database` is one serviceman
// made, a name RE_DATABASE checked.
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
    const client = CLIENTS[server.engine];
    const container = `serviceman-db-${server.name}`;
    const file = `/tmp/serviceman-${crypto.randomBytes(8).toString('hex')}${client.suffix}`;
    await engine_files_put(connect, container, '/tmp', [{name: file.slice('/tmp/'.length), bytes: Buffer.from(script)}]);
    const line = `${client.line(database)}; code=$?; rm -f "$1"; exit $code`;
    const said = await engine_exec(connect, container, ['sh', '-c', line, 'sh', file], [`SERVICEMAN_DB_USER=${user.user}`, `${client.password_env}=${user.password}`]);
    if (said.code !== 0) {
        const stderr = said.stderr.trim().split('\n').filter(v => v.includes('Using a password') === false).join('\n');
        throw Object.assign(new Error(stderr || `${server.engine}'s client ended with ${said.code}`), {stdout: said.stdout});
    }
    return said.stdout;
}

// How mysql signs in and talks: utf8mb4, binary values as hex, as the user, in its database
function mysql_options(database)
{
    return `--default-character-set=utf8mb4 --binary-as-hex -h 127.0.0.1 -u "$SERVICEMAN_DB_USER" '${database}'`;
}

module.exports = database_script;
