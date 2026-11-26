const row_changes_of = require('./row_changes_of');
const sql_row_from_text = require('./sql_row_from_text');

// A change of a SQL table's rows as the API was asked it, read for an adapter to write: `id` the
// row's key as the page read it, {column: value}; `set` the columns to set, each with its value:
// a row added, or the columns of a row edited whose values are not those `was`, the row as it was
// read, holds (all those given, without it); `was` what those columns held when it was read, null
// without it. A column left out of an edited row is left as it is. What is wrong is a refusal of
// the ask (400).
//
//     sql_change_from_ask({collection: 'orders', id: {id: 7}, document: '{"id": 7, "status": "paid"}', was: '{"id": 7, "status": "new"}'})
//     // {collection: 'orders', id: {id: 7}, set: {status: 'paid'}, was: {status: 'new'}}
function sql_change_from_ask(ask)
{
    const out = {collection: ask.collection, id: null, set: null, was: null};
    if (ask.id !== undefined) {
        if ((ask.id === null) || (typeof ask.id !== 'object') || Array.isArray(ask.id) || (Object.keys(ask.id).length === 0)) {
            throw Object.assign(new Error('id names the row by its key, as the page read it: {"id": 7}'), {status: 400});
        }
        out.id = ask.id;
    }
    if (ask.document !== undefined) {
        const row = sql_row_from_text(ask.document, 'row');
        const was = (ask.was === undefined) ? null : sql_row_from_text(ask.was, 'row as it was read');
        out.set = (was === null) ? row : row_changes_of(was, row);
        if (was !== null) {
            out.was = {};
            for (const name of Object.keys(out.set).filter(v => Object.hasOwn(was, v))) {
                out.was[name] = was[name];
            }
        }
    }
    return out;
}

module.exports = sql_change_from_ask;
