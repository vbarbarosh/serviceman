const database_sql = require('./database_sql');

// The schemas of a MySQL server itself, never shown as databases
const MYSQL_OWN = ['mysql', 'information_schema', 'performance_schema', 'sys'];

// The databases in a server, as it says them now: [{name, tables, bytes}], by name; an empty
// one too, with no table. PostgreSQL counts a database's tables in that database, one at a time.
async function database_list(connect, server)
{
    if (server.engine === 'postgresql') {
        const said = await database_sql(connect, server, "SELECT datname, pg_database_size(datname) FROM pg_database WHERE datistemplate = false AND datname <> 'postgres' ORDER BY datname;\n");
        const rows = rows_of(said).map(v => ({name: v[0], tables: 0, bytes: Number(v[1])}));
        for (const row of rows) {
            const counted = await database_sql(connect, server, "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema');\n", row.name);
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

function rows_of(said)
{
    return said.split('\n').filter(v => v !== '').map(v => v.split('\t'));
}

module.exports = database_list;
