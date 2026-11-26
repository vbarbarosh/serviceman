// The most and the least a 64-bit integer holds: an integer past them is a decimal here
const LONG_MOST = 9223372036854775807n;
const LONG_LEAST = -9223372036854775808n;
const RE_INTEGER = /^-?\d+$/;

// A number as an engine wrote it, kept whole the way relaxed Extended JSON keeps one: a plain
// number where JavaScript holds it and writes it back the same, else its digits as they came, an
// integer as {$numberLong}, a decimal as {$numberDecimal}, trailing zeros and all. One written
// with an exponent is a float, approximate by nature: a plain number.
//
//     ejson_number_from_text('42')                 // 42
//     ejson_number_from_text('9007199254740993')   // {$numberLong: '9007199254740993'}
//     ejson_number_from_text('12.30')              // {$numberDecimal: '12.30'}
//     ejson_number_from_text('1.5e-07')            // 1.5e-7
function ejson_number_from_text(text)
{
    const number = Number(text);
    if (RE_INTEGER.test(text)) {
        if (Number.isSafeInteger(number) && (String(number) === text)) {
            return number;
        }
        const long = BigInt(text);
        return ((long <= LONG_MOST) && (long >= LONG_LEAST)) ? {$numberLong: text} : {$numberDecimal: text};
    }
    if (/e/i.test(text) || (String(number) === text)) {
        return number;
    }
    return {$numberDecimal: text};
}

module.exports = ejson_number_from_text;
