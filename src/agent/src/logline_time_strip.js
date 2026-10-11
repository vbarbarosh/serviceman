const time_utc_nanos = require('./time_utc_nanos');

// The shapes of a time a line may start with — decided, notes/logline.md D3:
//   2026/09/25 22:47:45 then \s*[        2026-09-25T19:48:10.059Z then \s*[
//   either one wrapped in []
const SLASH = '\\d{4}/\\d\\d/\\d\\d \\d\\d:\\d\\d:\\d\\d(?:\\.\\d{1,9})?';
const ISO = '\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(?:\\.\\d{1,9})?(?:Z|[+-]\\d\\d:?\\d\\d)?';
const RE_BARE = new RegExp(`^(${SLASH}|${ISO})\\s*(?=\\[)`);
const RE_WRAPPED = new RegExp(`^\\[(${SLASH}|${ISO})\\]\\s*`);

// A line that starts with its own time -> that time, and the line without it. The time is the
// line's own; the one the provider stamped is only for a line that has none. A time with no
// zone is local time on this machine. One that is not a real time stays in the line, and the
// answer's time is null.
function logline_time_strip(line)
{
    const found = RE_WRAPPED.exec(line) || RE_BARE.exec(line);
    if (found === null) {
        return {time: null, line};
    }
    const time = time_utc_nanos(found[1].replace(/^(\d{4})\/(\d\d)\/(\d\d) /, '$1-$2-$3T'));
    if (time === null) {
        return {time: null, line};
    }
    return {time, line: line.slice(found[0].length)};
}

module.exports = logline_time_strip;
