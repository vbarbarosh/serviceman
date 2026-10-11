const crypto = require('crypto');

// A `c` and eleven letters and digits, drawn in two halves: one draw of 36^11 is more than
// crypto.randomInt gives
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
