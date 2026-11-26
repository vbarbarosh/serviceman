import mongo_type_of from './mongo_type_of.js';

// A MongoDB value as the shell writes it, from the relaxed Extended JSON the module's server
// answers: ObjectId('…'), ISODate('…'), NumberLong('…'), NumberDecimal('…'), UUID('…'), a
// /regex/, keys without quotes where they need none. What the filter takes back, so a value
// copied from a document finds it. A type the filter has no name for (a Timestamp, binary data
// other than a UUID) stays the Extended JSON it came as, which it takes too. An object or an
// array short enough stays on one line; the document itself never does.
//
//     mongo_text_of({_id: {$oid: '6b08…'}, at: {$date: '2026-11-26T10:59:41.480Z'}, tags: ['a']}, true)
//     // {
//     //     _id: ObjectId('6b08…'),
//     //     at: ISODate('2026-11-26T10:59:41.480Z'),
//     //     tags: ["a"]
//     // }
function mongo_text_of(value, whole)
{
    return text_of(value, '', whole);
}

// What fits on one line of the document's window
const LINE_MOST = 72;
const RE_BARE_KEY = /^[A-Za-z_$][\w$]*$/;

function text_of(value, indent, whole)
{
    const typed = typed_text(value);
    if (typed !== null) {
        return typed;
    }
    if ((value === null) || (typeof value !== 'object')) {
        return JSON.stringify(value);
    }
    const pairs = Array.isArray(value) ? value.map(v => ['', v]) : Object.entries(value);
    const open = Array.isArray(value) ? '[' : '{';
    const close = Array.isArray(value) ? ']' : '}';
    if (pairs.length === 0) {
        return open + close;
    }
    const inline = `${open}${pairs.map(v => pair_text(v, indent + '    ', false)).join(', ')}${close}`;
    if ((whole === false) && (inline.length + indent.length <= LINE_MOST) && (inline.includes('\n') === false)) {
        return inline;
    }
    const inner = indent + '    ';
    return `${open}\n${pairs.map(v => inner + pair_text(v, inner, false)).join(',\n')}\n${indent}${close}`;
}

function pair_text(pair, indent, whole)
{
    const value = text_of(pair[1], indent, whole);
    if (pair[0] === '') {
        return value;
    }
    return `${RE_BARE_KEY.test(pair[0]) ? pair[0] : JSON.stringify(pair[0])}: ${value}`;
}

// A value of one of the shell's types, as the shell writes it; null for any other
function typed_text(value)
{
    const type = mongo_type_of(value);
    if (type === 'id') {
        return `ObjectId('${value.$oid}')`;
    }
    if ((type === 'date') && (typeof value.$date === 'string')) {
        return `ISODate('${value.$date}')`;
    }
    if (type === 'long') {
        return `NumberLong('${value.$numberLong}')`;
    }
    if (type === 'decimal') {
        return `NumberDecimal('${value.$numberDecimal}')`;
    }
    if (type === 'uuid') {
        return `UUID('${uuid_of(value)}')`;
    }
    if (type === 'regex') {
        return `/${value.$regularExpression.pattern.replace(/(^|[^\\])\//g, '$1\\/')}/${value.$regularExpression.options}`;
    }
    return null;
}

// A UUID's hex, dashed, from its 16 bytes in base64
function uuid_of(value)
{
    const hex = Array.from(atob(value.$binary.base64), v => v.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default mongo_text_of;
