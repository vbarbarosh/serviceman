const RE_ISO = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/;

// An ISO time, in any zone and to the nanosecond -> the same instant in UTC, nine digits after
// the second: "2026-09-25T22:17:09.979+03:00" -> "2026-09-25T19:17:09.979000000Z". A string
// that is not such a time, or not a real one, is null. A Date keeps milliseconds only, so the
// fraction is carried beside it, untouched.
function time_utc(text)
{
    const found = (typeof text === 'string') ? RE_ISO.exec(text) : null;
    if (found === null) {
        return null;
    }
    const whole = new Date(`${found[1]}${found[3]}`);
    if (Number.isNaN(whole.getTime()) || (whole.toISOString().slice(0, 19) !== utc_of(found[1], found[3]))) {
        return null;
    }
    return `${whole.toISOString().slice(0, 19)}.${(found[2] || '').padEnd(9, '0')}Z`;
}

// What the seconds part says in UTC, computed by hand, so that a day like 2026-02-30 — which a
// Date quietly rolls over into March — is caught as the time it is not
function utc_of(local, zone)
{
    const parts = local.split(/[-T:]/).map(v => parseInt(v, 10));
    if ((parts[1] < 1) || (parts[1] > 12) || (parts[2] < 1) || (parts[2] > days_in(parts[0], parts[1])) || (parts[3] > 23) || (parts[4] > 59) || (parts[5] > 59)) {
        return '';
    }
    const shift = (zone === 'Z') ? 0 : ((zone[0] === '-') ? -1 : 1)*(parseInt(zone.slice(1, 3), 10)*60 + parseInt(zone.slice(4, 6), 10));
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4] - shift, parts[5])).toISOString().slice(0, 19);
}

function days_in(year, month)
{
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

module.exports = time_utc;
