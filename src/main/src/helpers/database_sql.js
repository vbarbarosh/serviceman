const crypto = require('crypto');
const engine_exec = require('./engine_exec');
const engine_files_put = require('./engine_files_put');

// SQL run as the server's root, inside its container: the text goes in as a file of its own,
// readable by root alone, and is removed when it has run, since it may hold a user's password;
// the root password goes in the exec's env. Answers with what it printed, a row a line, its
// fields split by tabs; a failure throws what the client said.
async function database_sql(connect, server, sql)
{
    const file = `/tmp/serviceman-${crypto.randomBytes(8).toString('hex')}.sql`;
    await engine_files_put(connect, container_of(server), '/tmp', [{name: file.slice('/tmp/'.length), bytes: Buffer.from(sql)}]);
    const said = await engine_exec(connect, container_of(server), ['sh', '-c', 'mysql --default-character-set=utf8mb4 -uroot -N -B < "$1"; code=$?; rm -f "$1"; exit $code', 'sh', file], [`MYSQL_PWD=${server.root}`]);
    if (said.code !== 0) {
        throw new Error(said.stderr.trim().split('\n').filter(v => v.includes('Using a password') === false).join(' ') || `mysql ended with ${said.code}`);
    }
    return said.stdout;
}

function container_of(server)
{
    return `serviceman-db-${server.name}`;
}

module.exports = database_sql;
