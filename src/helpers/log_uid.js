const crypto = require('crypto');

// A uid is twelve characters: a `c` and eleven letters and digits. The number behind them is
// drawn in two halves, because one draw of 36^11 is larger than crypto.randomInt will give.
//
// A uid is one word to a terminal, so a double click takes all of it, and it can never be read
// as a number. Nothing reads a uid, everything only matches it.
const UID_HALVES = [6, 5];

function log_uid()
{
    let out = 'c';
    for (const letters of UID_HALVES) {
        out += crypto.randomInt(Math.pow(36, letters)).toString(36).padStart(letters, '0');
    }
    return out;
}

module.exports = log_uid;
