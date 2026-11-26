const database_sql = require('./database_sql');
const engine_exec = require('./engine_exec');

// The schemas of a MySQL server itself, never shown as databases
const MYSQL_OWN = ['mysql', 'information_schema', 'performance_schema', 'sys'];
// A PostgreSQL database's tables as Browse lists them (postgresql_adapter): tables, partitioned
// ones and their partitions, views, materialized views and foreign tables, in every schema but
// its own, a session's temporary ones left out
const POSTGRESQL_TABLES = "SELECT count(*) FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relpersistence <> 't' AND n.nspname NOT IN ('pg_catalog', 'information_schema');\n";
// A MongoDB's databases, its own left out, `tables` its collections: listDatabases names a
// database only once something is written in it, so one with a user and nothing yet is added
// from its users, empty
const MONGODB_LIST = `const own = ['admin', 'config', 'local'];
const found = db.adminCommand({listDatabases: 1}).databases.filter(v => own.includes(v.name) === false);
const named = found.map(v => v.name);
for (const v of found) {
    print([v.name, db.getSiblingDB(v.name).getCollectionNames().filter(vv => vv.startsWith('system.') === false).length, v.sizeOnDisk].join('\\t'));
}
for (const v of db.getSiblingDB('admin').system.users.distinct('db')) {
    if ((own.includes(v) === false) && (named.includes(v) === false)) {
        print([v, 0, 0].join('\\t'));
    }
}
`;

// The databases in a server, as it says them now: [{name, tables, bytes}], by name; an empty
// one too, with no table. PostgreSQL counts a database's tables in that database, one at a time,
// as Browse lists them; a MySQL's are its tables and views, as Browse lists them too.
// A CouchDB is one row, its admin, the way an app is given it: `tables` its databases, made by
// that app, and `bytes` their files together, its own (_users, _replicator) left out. A
// MongoDB's `tables` are its collections as Browse lists them: system.* left out (system.views
// holds a view's pipeline, and is no collection of the app's).
async function database_list(connect, server)
{
    if (server.engine === 'couchdb') {
        return [await couchdb_row(connect, server)];
    }
    if (server.engine === 'mongodb') {
        const rows = rows_of(await database_sql(connect, server, MONGODB_LIST)).map(v => ({name: v[0], tables: Number(v[1]), bytes: Number(v[2])}));
        return rows.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (server.engine === 'postgresql') {
        const said = await database_sql(connect, server, "SELECT datname, pg_database_size(datname) FROM pg_database WHERE datistemplate = false AND datname <> 'postgres' ORDER BY datname;\n");
        const rows = rows_of(said).map(v => ({name: v[0], tables: 0, bytes: Number(v[1])}));
        for (const row of rows) {
            const counted = await database_sql(connect, server, POSTGRESQL_TABLES, row.name);
            row.tables = Number(counted.trim());
        }
        return rows;
    }
    const sql = `SELECT s.schema_name, COUNT(t.table_name), COALESCE(SUM(t.data_length + t.index_length), 0)
FROM information_schema.schemata s LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name
WHERE s.schema_name NOT IN (${MYSQL_OWN.map(v => `'${v}'`).join(', ')})
GROUP BY s.schema_name ORDER BY s.schema_name;
`;
    return rows_of(await database_sql(connect, server, sql)).map(v => ({name: v[0], tables: Number(v[1]), bytes: Number(v[2])}));
}

// Asked inside its container, its admin's password in the exec's env, never on a command line
async function couchdb_row(connect, server)
{
    const said = await engine_exec(connect, `serviceman-db-${server.name}`, ['sh', '-c', 'curl -fsS -u "admin:$COUCHDB_ADMIN_PASSWORD" http://127.0.0.1:5984/_dbs_info'], [`COUCHDB_ADMIN_PASSWORD=${server.root}`]);
    if (said.code !== 0) {
        throw new Error(said.stderr.trim() || `curl exited ${said.code}`);
    }
    const dbs = JSON.parse(said.stdout).filter(v => (v.key.startsWith('_') === false) && (v.info !== undefined));
    return {name: 'admin', tables: dbs.length, bytes: dbs.reduce((sum, v) => sum + v.info.sizes.file, 0)};
}

function rows_of(said)
{
    return said.split('\n').filter(v => v !== '').map(v => v.split('\t'));
}

module.exports = database_list;
