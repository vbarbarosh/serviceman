// Two Debian versions compared as dpkg compares them: the epoch, then the upstream version, then
// the revision; each of the last two in turns of letters and of digits, a tilde before
// anything, even the end, so 1.0~rc1 comes before 1.0.
//
//     debian_version_compare('1:2.0', '3.0')                 -> 1
//     debian_version_compare('6.8.0-147', '6.8.0-149')       -> -1
//     debian_version_compare('2.47-1ubuntu0.24.04.1', ...)   -> 0 when the same
function debian_version_compare(a, b)
{
    const one = parts_of(a);
    const two = parts_of(b);
    if (one.epoch !== two.epoch) {
        return (one.epoch < two.epoch) ? -1 : 1;
    }
    return sign(part_compare(one.upstream, two.upstream)) || sign(part_compare(one.revision, two.revision));
}

function parts_of(version)
{
    let text = String(version).trim();
    let epoch = 0;
    const colon = text.indexOf(':');
    if (colon > 0) {
        epoch = parseInt(text.slice(0, colon), 10) || 0;
        text = text.slice(colon + 1);
    }
    const dash = text.lastIndexOf('-');
    if (dash < 0) {
        return {epoch, upstream: text, revision: ''};
    }
    return {epoch, upstream: text.slice(0, dash), revision: text.slice(dash + 1)};
}

// dpkg's verrevcmp: letters before other signs, a tilde before all, the end and a digit in
// between
function part_compare(a, b)
{
    let i = 0;
    let j = 0;
    while ((i < a.length) || (j < b.length)) {
        while (((i < a.length) && (is_digit(a[i]) === false)) || ((j < b.length) && (is_digit(b[j]) === false))) {
            const one = order_of(a[i]);
            const two = order_of(b[j]);
            if (one !== two) {
                return one - two;
            }
            i++;
            j++;
        }
        while (a[i] === '0') {
            i++;
        }
        while (b[j] === '0') {
            j++;
        }
        let first = 0;
        while ((i < a.length) && is_digit(a[i]) && (j < b.length) && is_digit(b[j])) {
            if (first === 0) {
                first = a.charCodeAt(i) - b.charCodeAt(j);
            }
            i++;
            j++;
        }
        if ((i < a.length) && is_digit(a[i])) {
            return 1;
        }
        if ((j < b.length) && is_digit(b[j])) {
            return -1;
        }
        if (first !== 0) {
            return first;
        }
    }
    return 0;
}

function order_of(char)
{
    if ((char === undefined) || is_digit(char)) {
        return 0;
    }
    if (char === '~') {
        return -1;
    }
    if (/[A-Za-z]/.test(char)) {
        return char.charCodeAt(0);
    }
    return char.charCodeAt(0) + 256;
}

function is_digit(char)
{
    return (char !== undefined) && (char >= '0') && (char <= '9');
}

function sign(value)
{
    return (value < 0) ? -1 : ((value > 0) ? 1 : 0);
}

module.exports = debian_version_compare;
