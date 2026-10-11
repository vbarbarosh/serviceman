const crypto = require('crypto');

// The entry whose token is this one, or null. Every entry is compared in full, so how long the
// answer takes says nothing about how much of a guess was right.
function token_find(tokens, value)
{
    const given = crypto.createHash('sha256').update(String(value)).digest();
    let out = null;
    for (const item of tokens) {
        const kept = crypto.createHash('sha256').update(item.token).digest();
        if (crypto.timingSafeEqual(given, kept) && (out === null)) {
            out = item;
        }
    }
    return out;
}

module.exports = token_find;
