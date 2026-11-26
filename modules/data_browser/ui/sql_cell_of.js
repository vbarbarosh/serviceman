import mongo_cell_of from './mongo_cell_of.js';
import sql_text_of from './sql_text_of.js';

// A SQL row's value in a cell of the table, on one line: {text, kind, title}, kinds and colours
// as a MongoDB value's (mongo_cell_of): a string, a number, a boolean, null; a number the
// module's server kept whole is a number, its digits the text; an object or an array (a JSON
// column, a PostgreSQL array) its JSON, never the shell's words for it.
//
//     sql_cell_of({$numberDecimal: '2.50'})   // {text: '2.50', kind: 'number', title: ''}
//     sql_cell_of({a: [1, 2]})                // {text: '{"a": [1, 2]}', kind: 'object', title: '1 key'}
function sql_cell_of(value)
{
    if (value === undefined) {
        return {text: '', kind: 'none', title: 'not in this row'};
    }
    if ((value === null) || (typeof value !== 'object')) {
        return mongo_cell_of(value);
    }
    const text = sql_text_of(value, false).replace(/\n\s*/g, ' ');
    if (Array.isArray(value)) {
        return {text, kind: 'array', title: `${value.length} ${(value.length === 1) ? 'item' : 'items'}`};
    }
    const keys = Object.keys(value);
    if ((keys.length === 1) && ((keys[0] === '$numberLong') || (keys[0] === '$numberDecimal'))) {
        return {text, kind: 'number', title: ''};
    }
    return {text, kind: 'object', title: `${keys.length} ${(keys.length === 1) ? 'key' : 'keys'}`};
}

export default sql_cell_of;
