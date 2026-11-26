// A page of a SQL engine's rows as the data browser answers them: each row an object keyed by
// its columns' names, and the names in their order, which an object does not keep for a name
// that is a number ("2024"). A name met twice, a join's two ids, gets its place number after it,
// `id (2)`, so neither value is lost.
//
//     items_from_rows(['id', 'name', 'id'], [[1, 'a', 7]])
//     // {columns: ['id', 'name', 'id (2)'], items: [{id: 1, name: 'a', 'id (2)': 7}]}
function items_from_rows(names, rows)
{
    const columns = [];
    for (const name of names) {
        let unique = name;
        for (let n = 2; columns.includes(unique); ++n) {
            unique = `${name} (${n})`;
        }
        columns.push(unique);
    }
    const items = [];
    for (const row of rows) {
        const item = {};
        for (let i = 0, end = columns.length; i < end; ++i) {
            item[columns[i]] = (row[i] === undefined) ? null : row[i];
        }
        items.push(item);
    }
    return {columns, items};
}

module.exports = items_from_rows;
