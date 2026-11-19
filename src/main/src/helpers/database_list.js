const database_sql = require('./database_sql');

// The schemas of the server itself, never shown as databases
const OWN = ['mysql', 'information_schema', 'performance_schema', 'sys'];

// The databases in a server, as it says them now: [{name, tables, bytes}], by name; an empty
// one too, with no table
async function database_list(connect, server)
{
    const sql = `SELECT s.schema_name, COUNT(t.table_name), COALESCE(SUM(t.data_length + t.index_length), 0)
FROM information_schema.schemata s LEFT JOIN information_schema.tables t ON t.table_schema = s.schema_name
WHERE s.schema_name NOT IN (${OWN.map(v => `'${v}'`).join(', ')})
GROUP BY s.schema_name ORDER BY s.schema_name;
`;
    const said = await database_sql(connect, server, sql);
    return said.split('\n').filter(v => v !== '').map(function (line) {
        const [name, tables, bytes] = line.split('\t');
        return {name, tables: Number(tables), bytes: Number(bytes)};
    });
}

module.exports = database_list;
