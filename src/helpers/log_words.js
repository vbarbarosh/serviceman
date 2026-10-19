const BARE = /^[\x21-\x7e]+$/;
const UNSAFE = /["\\[\]]/;

// The details after the sender: `key=value`, one space between pairs.
//
// A value is written bare when it is a printable ASCII word that cannot be mistaken for
// anything else — no space, no double quote, no backslash, no square bracket — so what stands
// in the file is exactly the bytes that were sent: it cannot span two words, break the line, or
// mint a tag of its own. Everything else is JSON, which escapes what would break the shape and
// keeps an empty value visible as "".
function log_words(words)
{
    if (words === undefined) {
        return '';
    }
    const pairs = [];
    for (const name of Object.keys(words)) {
        const value = words[name];
        // A key with nothing behind it says nothing; it is left out rather than written as null
        if ((value === undefined) || (value === null)) {
            continue;
        }
        pairs.push(`${name}=${log_value(value)}`);
    }
    return pairs.join(' ');
}

function log_value(value)
{
    if (typeof value === 'string') {
        return (BARE.test(value) && (UNSAFE.test(value) === false)) ? value : JSON.stringify(value);
    }
    if ((typeof value === 'number') && Number.isFinite(value)) {
        return String(value);
    }
    // Arrays, objects, booleans and everything else go as compact JSON, so their shape survives
    return JSON.stringify(value);
}

module.exports = log_words;
