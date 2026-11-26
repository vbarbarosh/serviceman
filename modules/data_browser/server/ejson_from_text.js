// A MongoDB query as a person types it, read as data: JSON, or the shell's way of writing it,
// keys without quotes, strings in single quotes, a comma before the closing brace, and the
// shell's types, ObjectId('…'), ISODate('…'), new Date('…'), NumberLong('…'), NumberInt(…),
// NumberDecimal('…'), UUID('…'), a /regex/i. Answers the value in Extended JSON, each type as
// its $-key ({$oid}, {$date}, {$numberLong}…), for mongosh's EJSON.parse. Nothing in the text is
// run: a name that is none of those types is refused, so is anything after the value. Throws
// what is wrong and where, the place counted from 1.
//
//     ejson_from_text("{status: 'active', at: {$gt: ISODate('2026-01-01')}}")
//     // {status: 'active', at: {$gt: {$date: '2026-01-01T00:00:00.000Z'}}}
function ejson_from_text(text)
{
    const reader = {text: String(text), at: 0};
    space_skip(reader);
    if (reader.at === reader.text.length) {
        return {};
    }
    const out = value_read(reader);
    space_skip(reader);
    if (reader.at < reader.text.length) {
        wrong_throw(reader, 'something after the end');
    }
    return out;
}

// The shell's types, each made from the arguments it is given: a string, or a number where the
// shell takes one
const TYPES = {
    ObjectId: function (reader, args) {
        const hex = string_arg(reader, args, 'ObjectId');
        if (/^[0-9a-fA-F]{24}$/.test(hex) === false) {
            wrong_throw(reader, 'an ObjectId is 24 hex digits');
        }
        return {$oid: hex.toLowerCase()};
    },
    ISODate: date_made,
    Date: date_made,
    NumberLong: function (reader, args) {
        const digits = String(number_or_string_arg(reader, args, 'NumberLong'));
        if (/^-?\d{1,19}$/.test(digits) === false) {
            wrong_throw(reader, 'a NumberLong is a whole number');
        }
        return {$numberLong: digits};
    },
    NumberInt: function (reader, args) {
        const digits = String(number_or_string_arg(reader, args, 'NumberInt'));
        if ((/^-?\d{1,10}$/.test(digits) === false) || (Math.abs(Number(digits)) > 2147483648)) {
            wrong_throw(reader, 'a NumberInt is a whole number of 32 bits');
        }
        return {$numberInt: digits};
    },
    NumberDecimal: function (reader, args) {
        const digits = String(number_or_string_arg(reader, args, 'NumberDecimal'));
        if (/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(digits) === false) {
            wrong_throw(reader, 'a NumberDecimal is a number');
        }
        return {$numberDecimal: digits};
    },
    UUID: function (reader, args) {
        const hex = string_arg(reader, args, 'UUID');
        if (/^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/.test(hex) === false) {
            wrong_throw(reader, 'a UUID is 32 hex digits');
        }
        return {$uuid: hex.replace(/-/g, '').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-').toLowerCase()};
    },
};
const RE_NAME = /[A-Za-z_$][\w$.]*/y;
const RE_NUMBER = /-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/y;
const RE_SPACE = /(\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/y;

// One value, whatever its kind, at where the reader is
function value_read(reader)
{
    space_skip(reader);
    const char = reader.text[reader.at];
    if (char === '{') {
        return object_read(reader);
    }
    if (char === '[') {
        return array_read(reader);
    }
    if ((char === '"') || (char === '\'')) {
        return string_read(reader);
    }
    if (char === '/') {
        return regex_read(reader);
    }
    if ((char === '-') || (char === '.') || ((char >= '0') && (char <= '9'))) {
        return number_read(reader);
    }
    const name = name_read(reader);
    if (name === null) {
        wrong_throw(reader, (char === undefined) ? 'it ends before its value' : `${JSON.stringify(char)} begins no value`);
    }
    if (name === 'true') {
        return true;
    }
    if (name === 'false') {
        return false;
    }
    if (name === 'null') {
        return null;
    }
    return call_read(reader, name);
}

function object_read(reader)
{
    const out = {};
    reader.at++;
    space_skip(reader);
    while (reader.text[reader.at] !== '}') {
        const key = key_read(reader);
        space_skip(reader);
        char_take(reader, ':');
        out[key] = value_read(reader);
        if (list_next(reader, '}') === false) {
            break;
        }
    }
    reader.at++;
    return out;
}

function array_read(reader)
{
    const out = [];
    reader.at++;
    space_skip(reader);
    while (reader.text[reader.at] !== ']') {
        out.push(value_read(reader));
        if (list_next(reader, ']') === false) {
            break;
        }
    }
    reader.at++;
    return out;
}

// After an item of an object or an array: a comma and the next, or its end, a comma before the
// end allowed. Answers false at the end, which it leaves for the caller to step over.
function list_next(reader, end)
{
    space_skip(reader);
    if (reader.text[reader.at] === ',') {
        reader.at++;
        space_skip(reader);
        return reader.text[reader.at] !== end;
    }
    if (reader.text[reader.at] !== end) {
        wrong_throw(reader, `a comma or ${end} was expected`);
    }
    return false;
}

// A key: in quotes, a name ($gt, address.city) or a number
function key_read(reader)
{
    const char = reader.text[reader.at];
    if ((char === '"') || (char === '\'')) {
        return string_read(reader);
    }
    const name = name_read(reader);
    if (name !== null) {
        return name;
    }
    RE_NUMBER.lastIndex = reader.at;
    const found = RE_NUMBER.exec(reader.text);
    if (found === null) {
        wrong_throw(reader, 'a key was expected');
    }
    reader.at = RE_NUMBER.lastIndex;
    return found[0];
}

// A string in double or single quotes, with JSON's escapes and \'
function string_read(reader)
{
    const quote = reader.text[reader.at];
    let out = '';
    reader.at++;
    while (reader.text[reader.at] !== quote) {
        const char = reader.text[reader.at];
        if ((char === undefined) || (char === '\n')) {
            wrong_throw(reader, 'a string is not closed');
        }
        if (char !== '\\') {
            out += char;
            reader.at++;
            continue;
        }
        out += escape_read(reader);
    }
    reader.at++;
    return out;
}

const ESCAPES = {'n': '\n', 't': '\t', 'r': '\r', 'b': '\b', 'f': '\f', '0': '\0', '\\': '\\', '/': '/', '"': '"', '\'': '\''};

function escape_read(reader)
{
    const char = reader.text[reader.at + 1];
    if (char === 'u') {
        const hex = reader.text.slice(reader.at + 2, reader.at + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex) === false) {
            wrong_throw(reader, '\\u takes 4 hex digits');
        }
        reader.at += 6;
        return String.fromCharCode(parseInt(hex, 16));
    }
    if (ESCAPES[char] === undefined) {
        wrong_throw(reader, `no such escape: \\${char}`);
    }
    reader.at += 2;
    return ESCAPES[char];
}

function number_read(reader)
{
    RE_NUMBER.lastIndex = reader.at;
    const found = RE_NUMBER.exec(reader.text);
    if (found === null) {
        wrong_throw(reader, 'a number was expected');
    }
    reader.at = RE_NUMBER.lastIndex;
    const out = Number(found[0]);
    // A whole number past what a double holds whole keeps its digits
    if (/^-?\d+$/.test(found[0]) && (Number.isSafeInteger(out) === false)) {
        if (/^-?\d{1,19}$/.test(found[0]) === false) {
            wrong_throw(reader, 'a whole number of more than 64 bits');
        }
        return {$numberLong: found[0]};
    }
    return out;
}

// /pattern/flags, as the shell writes a regular expression
function regex_read(reader)
{
    const begin = reader.at;
    let pattern = '';
    let in_class = false;
    reader.at++;
    while ((reader.text[reader.at] !== '/') || in_class) {
        const char = reader.text[reader.at];
        if ((char === undefined) || (char === '\n')) {
            reader.at = begin;
            wrong_throw(reader, 'a regular expression is not closed');
        }
        if (char === '\\') {
            pattern += reader.text.slice(reader.at, reader.at + 2);
            reader.at += 2;
            continue;
        }
        if (char === '[') {
            in_class = true;
        }
        if (char === ']') {
            in_class = false;
        }
        pattern += char;
        reader.at++;
    }
    reader.at++;
    const flags = /[a-z]*/y;
    flags.lastIndex = reader.at;
    const options = flags.exec(reader.text)[0];
    if (/^[imsx]*$/.test(options) === false) {
        wrong_throw(reader, 'a regular expression takes the flags i, m, s and x');
    }
    reader.at = flags.lastIndex;
    return {$regularExpression: {pattern, options: options.split('').sort().join('')}};
}

// A type of the shell, with new or without, and its arguments in brackets
function call_read(reader, name)
{
    const begin = reader.at - name.length;
    let type = name;
    if (name === 'new') {
        space_skip(reader);
        type = name_read(reader);
    }
    if ((type === null) || (Object.hasOwn(TYPES, type) === false)) {
        reader.at = begin;
        wrong_throw(reader, `${JSON.stringify(type || name)} is not a value: a query is data, the shell's types (ObjectId, ISODate, NumberLong…) and no code`);
    }
    space_skip(reader);
    char_take(reader, '(');
    const args = [];
    space_skip(reader);
    while (reader.text[reader.at] !== ')') {
        args.push(value_read(reader));
        if (list_next(reader, ')') === false) {
            break;
        }
    }
    reader.at++;
    return TYPES[type](reader, args);
}

function date_made(reader, args)
{
    const when = (args.length === 0) ? new Date() : new Date(number_or_string_arg(reader, args, 'a date'));
    if (Number.isNaN(when.getTime())) {
        wrong_throw(reader, 'no date can be read from it');
    }
    return {$date: when.toISOString()};
}

function string_arg(reader, args, type)
{
    if ((args.length !== 1) || (typeof args[0] !== 'string')) {
        wrong_throw(reader, `${type} takes one string`);
    }
    return args[0];
}

function number_or_string_arg(reader, args, type)
{
    if ((args.length !== 1) || ((typeof args[0] !== 'string') && (typeof args[0] !== 'number'))) {
        wrong_throw(reader, `${type} takes one string or number`);
    }
    return args[0];
}

function name_read(reader)
{
    RE_NAME.lastIndex = reader.at;
    const found = RE_NAME.exec(reader.text);
    if (found === null) {
        return null;
    }
    reader.at = RE_NAME.lastIndex;
    return found[0];
}

function char_take(reader, char)
{
    if (reader.text[reader.at] !== char) {
        wrong_throw(reader, `${char} was expected`);
    }
    reader.at++;
}

// Spaces, new lines and comments
function space_skip(reader)
{
    RE_SPACE.lastIndex = reader.at;
    RE_SPACE.exec(reader.text);
    reader.at = RE_SPACE.lastIndex;
}

// What is wrong, where: line and column for a text of many lines, the place in one of one
function wrong_throw(reader, said)
{
    const before = reader.text.slice(0, reader.at).split('\n');
    const place = (before.length === 1) ? `at ${reader.at + 1}` : `on line ${before.length}, at ${before[before.length - 1].length + 1}`;
    const error = new Error(`${said}, ${place}`);
    error.status = 400;
    throw error;
}

module.exports = ejson_from_text;
