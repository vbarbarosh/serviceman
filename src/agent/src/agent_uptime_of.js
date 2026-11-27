const agent_uptime_count = require('./agent_uptime_count');
const agent_uptime_state = require('./agent_uptime_state');

// A day lists this many stretches, the longest; the rest are a count
const DOWN_LISTED = 20;

const formats = {};

// The last `days` days up to `until`, oldest first, in servermon's time zone, the one its day
// files are named in: how long each was known (since servermon's first line, up to `until`), how
// long of that the machine was down, and the stretches. A stretch still open at `until` (no line
// for longer than a gap) is down too, its why `silent`.
function agent_uptime_of(days, until)
{
    const tz = process.env.TZ || 'Europe/Chisinau';
    const state = agent_uptime_state;
    const down = state.down.slice();
    if ((state.last_at !== null) && ((until - state.last_at) > agent_uptime_count.GAP_MS)) {
        down.push({since: state.last_at + 1000, until, why: 'silent'});
    }
    const today = format_of(tz, {year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(until)).split('-').map(Number);
    const list = [];
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(Date.UTC(today[0], today[1] - 1, today[2] - i));
        const day_since = midnight_of(date, tz);
        const day_until = midnight_of(new Date(date.getTime() + 24*60*60*1000), tz);
        const known_since = (state.first_at === null) ? day_until : Math.max(day_since, state.first_at);
        const known_until = Math.min(day_until, until);
        const stretches = [];
        for (const item of down) {
            if ((item.until > known_since) && (item.since < known_until)) {
                stretches.push({since: Math.max(item.since, known_since), until: Math.min(item.until, known_until), why: item.why});
            }
        }
        const listed = stretches.slice().sort((a, b) => (b.until - b.since) - (a.until - a.since)).slice(0, DOWN_LISTED).sort((a, b) => a.since - b.since);
        list.push({
            day: date.toISOString().slice(0, 10),
            known_ms: Math.max(0, known_until - known_since),
            down_ms: stretches.reduce((sum, v) => sum + (v.until - v.since), 0),
            down: listed,
            down_more: stretches.length - listed.length,
        });
    }
    return {tz, until, days: list};
}

// The moment a day starts in the time zone: its UTC midnight moved by the zone's offset, taken
// again at the moment found, for a day that starts on the other side of a clock change
function midnight_of(date, tz)
{
    const guess = date.getTime();
    return guess - offset_of(guess - offset_of(guess, tz), tz);
}

function offset_of(at, tz)
{
    const name = format_of(tz, {timeZoneName: 'longOffset'}).formatToParts(new Date(at)).find(v => v.type === 'timeZoneName').value;
    const found = /([+-])(\d{2}):(\d{2})/.exec(name);
    if (found === null) {
        return 0;
    }
    return ((found[1] === '-') ? -1 : 1)*(Number(found[2])*60 + Number(found[3]))*60*1000;
}

// A formatter is slow to make and asked for every day of every answer: one per zone and kind
function format_of(tz, options)
{
    const key = `${tz} ${Object.keys(options).join(',')}`;
    if (formats[key] === undefined) {
        formats[key] = new Intl.DateTimeFormat('en-CA', Object.assign({timeZone: tz}, options));
    }
    return formats[key];
}

module.exports = agent_uptime_of;
