const RE_ISO = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:?\d\d)?$/;

// An ISO time -> the same instant in UTC, nine digits after the second, so two of them compare
// as strings: "2026-09-25T22:17:09.979+03:00" -> "2026-09-25T19:17:09.979000000Z". Docker
// writes its stamps this way, but drops trailing zeros, which would sort ".98Z" after ".979Z".
// A time with no zone is local time here. Not a real time — a 30th of February — is null.
function time_utc_nanos(text)
{
    const found = (typeof text === 'string') ? RE_ISO.exec(text) : null;
    if (found === null) {
        return null;
    }
    const parts = found.slice(1, 7).map(v => parseInt(v, 10));
    const days = new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
    if ((parts[1] < 1) || (parts[1] > 12) || (parts[2] < 1) || (parts[2] > days) || (parts[3] > 23) || (parts[4] > 59) || (parts[5] > 59)) {
        return null;
    }
    const zone = found[8];
    let ms;
    if (zone === undefined) {
        ms = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]).getTime();
    }
    else {
        const sign = (zone === 'Z') ? 0 : ((zone[0] === '-') ? -1 : 1);
        const digits = zone.replace(/[^0-9]/g, '');
        const shift = (sign === 0) ? 0 : sign*(parseInt(digits.slice(0, 2), 10)*60 + parseInt(digits.slice(2, 4), 10));
        ms = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4] - shift, parts[5]);
    }
    return `${new Date(ms).toISOString().slice(0, 19)}.${(found[7] || '').padEnd(9, '0')}Z`;
}

module.exports = time_utc_nanos;
