const RE_DURATION = /^([0-9]+(?:\.[0-9]+)?)(ms|s|m|h|d)$/;

const MS_BY_UNIT = {ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000};

// '10m' -> 600000; a bare number is seconds; null/false/'off' -> null (disabled)
function duration_ms_from_text(value, label)
{
    if ((value === null) || (value === undefined) || (value === false) || (value === '') || (value === 'off')) {
        return null;
    }
    if (typeof value === 'number') {
        return Math.round(value*1000);
    }
    const match = RE_DURATION.exec(String(value).trim());
    if (match === null) {
        throw new Error(`${label}: expected a duration like 30s, 10m, 2h (got ${JSON.stringify(value)})`);
    }
    return Math.round(parseFloat(match[1])*MS_BY_UNIT[match[2]]);
}

module.exports = duration_ms_from_text;
