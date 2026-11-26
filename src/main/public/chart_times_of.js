const MINUTE_MS = 60000;
const DAY_MS = 24*60*MINUTE_MS;
// The steps between round times, in minutes below a day, then in days: the first that leaves
// no more times between the ends than there is room for is taken
const STEPS_MINUTES = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720];
const STEPS_DAYS = [1, 2, 7, 14];
// How near an edge a round time may stand, a share of the chart's width: nearer, it would touch
// the start or the end said there
const EDGE_SHARE = 0.1;

// The times under a chart: its start and its end at the edges, and the round times between them
// (18:00, Nov 26, 06:00), as many as there is room for, each at its place across the chart. The
// start says its day where the chart crosses one (24h, or ten minutes of another day), so a
// start and an end of the same hour never read alike; a week or a month says days alone. The
// end is "now", or when the machine went.
//
//     data     the machine's answer: {range: '24h', from, to, away}, from and to in ms
//     most     how many round times there is room for between the ends: 1 or more
//     now      the time now, in ms: a time of another day than now's says its day
//     ->       {start: 'Nov 25 12:02', end: 'now', ticks: [{at, share: 0.25, said: '18:00'}, …]}
function chart_times_of(data, most, now)
{
    const days = (data.range === '7d') || (data.range === '30d');
    const start = days ? format_day(data.from) : format_time(data.from, (data.range === '24h') || (is_same_day(data.from, now) === false));
    let end = 'now';
    if (data.away === true) {
        end = days ? format_day(data.to) : format_time(data.to, (is_same_day(data.to, now) === false));
    }
    return {start, end, ticks: ticks_of(data.from, data.to, most)};
}

// The round times between two moments, clear of the edges, at the first step that leaves at
// most `most`; none where even two weeks leave more. A step whose clear stretch alone holds more
// is not counted out: a month at every minute would be 43,200 of them, at every refresh.
function ticks_of(from, to, most)
{
    const span = to - from;
    const room = span*(1 - 2*EDGE_SHARE);
    function is_clear(at) {
        return ((at - from)/span >= EDGE_SHARE) && ((at - from)/span <= 1 - EDGE_SHARE);
    }
    for (const step of STEPS_MINUTES) {
        if (Math.floor(room/(step*MINUTE_MS)) > most) {
            continue;
        }
        const ats = ats_of_clock(from, to, step).filter(is_clear);
        if (ats.length <= most) {
            return ats.map(v => tick_of(v, from, span, is_midnight(v) ? format_day(v) : format_time(v, false)));
        }
    }
    for (const step of STEPS_DAYS) {
        if (Math.floor(room/(step*DAY_MS)) > most) {
            continue;
        }
        const ats = ats_of_days(from, to, step).filter(is_clear);
        if (ats.length <= most) {
            return ats.map(v => tick_of(v, from, span, format_day(v)));
        }
    }
    return [];
}

// Every `step` minutes of the clock from midnight: 00:00, 06:00, 12:00, 18:00 for six hours;
// the clock's, so a day the clocks go back keeps them round
function ats_of_clock(from, to, step)
{
    const first = new Date(from);
    const minutes = first.getHours()*60 + first.getMinutes() + first.getSeconds()/60 + first.getMilliseconds()/MINUTE_MS;
    const at = new Date(first.getFullYear(), first.getMonth(), first.getDate(), 0, Math.ceil(minutes/step)*step);
    if (at.getTime() <= from) {
        at.setMinutes(at.getMinutes() + step);
    }
    const out = [];
    while (at.getTime() < to) {
        out.push(at.getTime());
        at.setMinutes(at.getMinutes() + step);
    }
    return out;
}

// Every `step` days at midnight, the same days whatever the range's start: weeks on Mondays,
// two weeks on every other Monday, two days on every other day, counted from 1970
function ats_of_days(from, to, step)
{
    const first = new Date(from);
    const at = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 1);
    const out = [];
    while (at.getTime() < to) {
        const day = Math.round(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate())/DAY_MS);
        if ((day + 3) % step === 0) {
            out.push(at.getTime());
        }
        at.setDate(at.getDate() + 1);
    }
    return out;
}

// A round time and where it stands across the chart; midnight says its day
function tick_of(at, from, span, said)
{
    return {at, share: (at - from)/span, said};
}

function is_midnight(at)
{
    const date = new Date(at);
    return (date.getHours() === 0) && (date.getMinutes() === 0);
}

// 12:02, or Nov 25 12:02 with its day, in the browser's zone
function format_time(at, with_day)
{
    const time = new Date(at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
    return with_day ? `${format_day(at)} ${time}` : time;
}

// Nov 25
function format_day(at)
{
    return new Date(at).toLocaleDateString([], {month: 'short', day: 'numeric'});
}

function is_same_day(a, b)
{
    return new Date(a).toDateString() === new Date(b).toDateString();
}

export default chart_times_of;
