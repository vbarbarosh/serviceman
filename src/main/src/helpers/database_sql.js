const crypto = require('crypto');
const database_engines = require('./database_engines');
const engine_exec = require('./engine_exec');
const engine_files_put = require('./engine_files_put');

// The client of each engine, run as root on a file of SQL: what it prints is a row a line, its
// fields split by tabs, and a statement that fails stops it with what it said. PostgreSQL runs it
// in the database named, postgres when none is.
const CLIENTS = {
    mysql: () => 'mysql --default-character-set=utf8mb4 -uroot -N -B < "$1"',
    postgresql: v => `psql -v ON_ERROR_STOP=1 -q -X -U postgres -At -F "$(printf '\\t')" -d '${v || 'postgres'}' -f "$1"`,
};

// SQL run as the server's root, inside its container: the text goes in as a file of its own,
// readable by root alone, and is removed when it has run, since it may hold a user's password;
// root's password goes in the exec's env. Answers with what it printed; a failure throws what
// the client said. `database` is where PostgreSQL runs it; a name serviceman checked or made.
async function database_sql(connect, server, sql, database)
{
    const engine = database_engines.find(v => v.value === server.engine);
    const container = `serviceman-db-${server.name}`;
    const file = `/tmp/serviceman-${crypto.randomBytes(8).toString('hex')}.sql`;
    await engine_files_put(connect, container, '/tmp', [{name: file.slice('/tmp/'.length), bytes: Buffer.from(sql)}]);
    const line = `${CLIENTS[engine.value](database)}; code=$?; rm -f "$1"; exit $code`;
    const said = await engine_exec(connect, container, ['sh', '-c', line, 'sh', file], [`${engine.password_env}=${server.root}`]);
    if (said.code !== 0) {
        throw new Error(said.stderr.trim().split('\n').filter(v => v.includes('Using a password') === false).join(' ') || `${engine.label}'s client ended with ${said.code}`);
    }
    return said.stdout;
}

module.exports = database_sql;
