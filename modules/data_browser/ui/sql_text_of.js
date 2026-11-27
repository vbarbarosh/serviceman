// What fits on one line of the row's window
const LINE_MOST = 72;
// The keys the module's server keeps a number JavaScript would round under, its digits whole
const DIGITS_KEYS = ['$numberLong', '$numberDecimal'];

// A SQL row, or a value of one, as JSON, as its engine gives it: a number the module's server
// kept whole ({$numberLong} or {$numberDecimal}) written with its digits, 2.50 and not 2.5; a row
// given as a Map keeps its columns' order, which an object does not for a name that is a number
// ("2024"). An object or an array short enough stays on one line; the row itself, whole, never
// does. What Copy copies.
//
//     sql_text_of(new Map([['id', 1], ['price', {$numberDecimal: '2.50'}]]), true)
//     // {
//     //     "id": 1,
//     //     "price": 2.50
//     // }
function sql_text_of(value, whole)
{
    return text_of(value, '', whole);
}

function text_of(value, indent, whole)
{
    const digits = digits_of(value);
    if (digits !== null) {
        return digits;
    }
    if ((value === null) || (value === undefined) || (typeof value !== 'object')) {
        return (value === undefined) ? 'null' : JSON.stringify(value);
    }
    const listed = Array.isArray(value);
    const pairs = listed ? value.map(v => ({key: null, value: v})) : Array.from((value instanceof Map) ? value.entries() : Object.entries(value), v => ({key: v[0], value: v[1]}));
    const open = listed ? '[' : '{';
    const close = listed ? ']' : '}';
    if (pairs.length === 0) {
        return open + close;
    }
    // Each value written once, whichever way it is laid out: written for each, a value nested n
    // deep was written 2ⁿ times, and a deep JSON column froze the page for minutes
    const inner = `${indent}    `;
    const texts = pairs.map(v => pair_text(v, inner));
    if (whole === false) {
        const inline = `${open}${texts.join(', ')}${close}`;
        if (((inline.length + indent.length) <= LINE_MOST) && (inline.includes('\n') === false)) {
            return inline;
        }
    }
    return `${open}\n${texts.map(v => inner + v).join(',\n')}\n${indent}${close}`;
}

function pair_text(pair, indent)
{
    const value = text_of(pair.value, indent, false);
    return (pair.key === null) ? value : `${JSON.stringify(pair.key)}: ${value}`;
}

// The digits of a number kept whole; null for any other value
function digits_of(value)
{
    if ((value === null) || (typeof value !== 'object') || Array.isArray(value) || (value instanceof Map)) {
        return null;
    }
    const keys = Object.keys(value);
    if ((keys.length !== 1) || (DIGITS_KEYS.includes(keys[0]) === false) || (typeof value[keys[0]] !== 'string')) {
        return null;
    }
    return value[keys[0]];
}

export default sql_text_of;
