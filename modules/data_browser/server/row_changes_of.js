// The columns of a row as edited whose values are not those it was read with: each with its new
// value, in the order they are in the row as edited. A column left out of it is left as it is,
// and one the row was not read with is a change. Values are compared as the page holds them,
// numbers kept whole ({$numberLong}, {$numberDecimal}) by their digits, objects key by key.
//
//     row_changes_of({id: 7, name: 'a', price: {$numberDecimal: '2.50'}}, {id: 7, name: 'b', price: {$numberDecimal: '2.50'}})
//     // {name: 'b'}
function row_changes_of(was, row)
{
    const out = {};
    for (const [name, value] of Object.entries(row)) {
        if ((Object.hasOwn(was, name) === false) || (is_same(was[name], value) === false)) {
            out[name] = value;
        }
    }
    return out;
}

function is_same(a, b)
{
    if ((a === null) || (b === null) || (typeof a !== 'object') || (typeof b !== 'object')) {
        return a === b;
    }
    if (Array.isArray(a) !== Array.isArray(b)) {
        return false;
    }
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) {
        return false;
    }
    return keys.every(v => Object.hasOwn(b, v) && is_same(a[v], b[v]));
}

module.exports = row_changes_of;
