// A log line describes an event; it is not payload storage. What does not fit is cut on a
// character boundary — never inside a utf-8 sequence — and the line ends with the number of
// bytes that were left out.
function log_trim(text, bytes)
{
    const raw = Buffer.from(text, 'utf8');
    if (raw.length <= bytes) {
        return text;
    }
    let end = bytes;
    while ((end > 0) && ((raw[end] & 0xc0) === 0x80)) {
        end--;
    }
    return `${raw.subarray(0, end).toString('utf8')}...+${raw.length - end}`;
}

module.exports = log_trim;
