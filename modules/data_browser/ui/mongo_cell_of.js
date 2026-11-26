import mongo_text_of from './mongo_text_of.js';
import mongo_type_of from './mongo_type_of.js';

// A value in a cell of the table, on one line: {text, kind, title}; kind is what colours it
// (id, date, number, string, bool, null, object, array, other), title the whole of it where the
// cell cuts it. A key the document does not have is kind none.
//
//     mongo_cell_of({$oid: '6b08…'})   // {text: '6b08…', kind: 'id', title: "ObjectId('6b08…')"}
//     mongo_cell_of(['a', 'b'])        // {text: '["a", "b"]', kind: 'array', title: '2 items'}
function mongo_cell_of(value)
{
    if (value === undefined) {
        return {text: '', kind: 'none', title: 'not in this document'};
    }
    const type = mongo_type_of(value);
    if (type === 'id') {
        return {text: value.$oid, kind: 'id', title: mongo_text_of(value, false)};
    }
    if (type === 'date') {
        return {text: (typeof value.$date === 'string') ? value.$date : JSON.stringify(value.$date), kind: 'date', title: 'a date, UTC'};
    }
    if ((type === 'long') || (type === 'decimal')) {
        return {text: (type === 'long') ? value.$numberLong : value.$numberDecimal, kind: 'number', title: mongo_text_of(value, false)};
    }
    if ((type === 'uuid') || (type === 'regex')) {
        return {text: mongo_text_of(value, false), kind: 'other', title: ''};
    }
    if (type === 'other') {
        return {text: mongo_text_of(value, false), kind: 'other', title: ''};
    }
    if (value === null) {
        return {text: 'null', kind: 'null', title: ''};
    }
    if (typeof value === 'number') {
        return {text: String(value), kind: 'number', title: ''};
    }
    if (typeof value === 'boolean') {
        return {text: String(value), kind: 'bool', title: ''};
    }
    if (typeof value === 'string') {
        return {text: (value === '') ? '""' : value, kind: (value === '') ? 'null' : 'string', title: (value.length > 40) ? value.slice(0, 2000) : ''};
    }
    const text = mongo_text_of(value, false).replace(/\n\s*/g, ' ');
    if (Array.isArray(value)) {
        return {text, kind: 'array', title: `${value.length} ${(value.length === 1) ? 'item' : 'items'}`};
    }
    const count = Object.keys(value).length;
    return {text, kind: 'object', title: `${count} ${(count === 1) ? 'key' : 'keys'}`};
}

export default mongo_cell_of;
