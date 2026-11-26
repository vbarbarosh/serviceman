// The keys a number is kept whole under, its digits as they came (ejson_number_from_text)
const DIGITS_KEYS = ['$numberLong', '$numberDecimal'];
const RE_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

// Relaxed Extended JSON as JSON text for a SQL engine, which reads a number by its digits: a
// number kept whole ({$numberLong}, {$numberDecimal}) written as those digits, where
// JSON.stringify would write the object. The mirror of ejson_from_json: what it read, written
// back the same.
//
//     json_from_ejson({big: {$numberLong: '9007199254740993'}, price: {$numberDecimal: '2.50'}})
//     // '{"big":9007199254740993,"price":2.50}'
function json_from_ejson(value)
{
    const digits = digits_of(value);
    if (digits !== null) {
        return digits;
    }
    if (Array.isArray(value)) {
        return `[${value.map(v => ((v === undefined) ? 'null' : json_from_ejson(v))).join(',')}]`;
    }
    if ((value !== null) && (typeof value === 'object')) {
        const pairs = Object.entries(value).filter(v => v[1] !== undefined);
        return `{${pairs.map(v => `${JSON.stringify(v[0])}:${json_from_ejson(v[1])}`).join(',')}}`;
    }
    // A number past a double's most, 1e999, is none JSON writes: JSON.stringify would write null
    if ((typeof value === 'number') && (Number.isFinite(value) === false)) {
        throw Object.assign(new Error(`${value} is no number JSON holds: write it as text, "${value}"`), {status: 400});
    }
    return JSON.stringify(value);
}

// The digits of a number kept whole; null for any other value, and for one whose digits are no
// JSON number, which is then written as the object it is
function digits_of(value)
{
    if ((value === null) || (typeof value !== 'object') || Array.isArray(value)) {
        return null;
    }
    const keys = Object.keys(value);
    if ((keys.length !== 1) || (DIGITS_KEYS.includes(keys[0]) === false) || (typeof value[keys[0]] !== 'string')) {
        return null;
    }
    return RE_NUMBER.test(value[keys[0]]) ? value[keys[0]] : null;
}

module.exports = json_from_ejson;
