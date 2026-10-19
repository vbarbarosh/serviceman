const ip_bytes = require('./ip_bytes');

// Whether an address is one of a list of addresses and ranges: "100.64.0.20",
// "100.64.0.0/10", "fd7a:115c:a1e0::/48". A range that is not written right allows nothing.
function ip_allowed(ip, list)
{
    const caller = ip_bytes(ip);
    if (caller === null) {
        return false;
    }
    for (const item of list) {
        const parts = item.split('/');
        const base = ip_bytes(parts[0]);
        if ((base === null) || (base.length !== caller.length)) {
            continue;
        }
        const bits = (parts.length === 1) ? base.length*8 : parseInt(parts[1], 10);
        if ((Number.isInteger(bits) === false) || (bits < 0) || (bits > base.length*8)) {
            continue;
        }
        if (prefix_equal(caller, base, bits)) {
            return true;
        }
    }
    return false;
}

function prefix_equal(a, b, bits)
{
    const whole = Math.floor(bits/8);
    if (a.subarray(0, whole).equals(b.subarray(0, whole)) === false) {
        return false;
    }
    const rest = bits % 8;
    if (rest === 0) {
        return true;
    }
    const mask = (0xff << (8 - rest)) & 0xff;
    return (a[whole] & mask) === (b[whole] & mask);
}

module.exports = ip_allowed;
