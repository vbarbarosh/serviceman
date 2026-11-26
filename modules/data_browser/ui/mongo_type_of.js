// Which of the shell's types an Extended JSON value is: id, date, long, decimal, uuid, regex,
// another (a Timestamp, binary data, MinKey, a double that is no number), or null for a plain
// value, an object or an array
function mongo_type_of(value)
{
    if ((value === null) || (typeof value !== 'object') || Array.isArray(value)) {
        return null;
    }
    const keys = Object.keys(value);
    if ((keys.length !== 1) || (keys[0][0] !== '$')) {
        return null;
    }
    const types = {$oid: 'id', $date: 'date', $numberLong: 'long', $numberDecimal: 'decimal', $regularExpression: 'regex', $numberDouble: 'other', $timestamp: 'other', $minKey: 'other', $maxKey: 'other', $symbol: 'other', $code: 'other', $undefined: 'other'};
    if (keys[0] === '$binary') {
        return (value.$binary.subType === '04') ? 'uuid' : 'other';
    }
    return (types[keys[0]] === undefined) ? null : types[keys[0]];
}

export default mongo_type_of;
