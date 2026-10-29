const remote_unanswered = require('./remote_unanswered');

// How long a call may wait, and a file's bytes stand, before the way to a machine is taken to
// stand: a full link holds a call behind the 4 MB on their way, seconds on the slowest link a
// file is worth sending over; half a minute is no link that moves
// (SERVICEMAN_STOOD_MS, for a test that cannot wait half a minute)
const STOOD_MS = 30000;
// A machine heard this recently is one whose way back works: it says its numbers every 5 s
const HEARD_MS = 8000;

// The way to a machine stands when a quick call has waited STOOD_MS for its answer, a file
// going to it has bytes it has not taken and took none for STOOD_MS, and the machine itself is
// still heard. Its link is stuck in one direction, and waiting for it to move took 1½ to 4
// minutes on 2026-10-29 (one server, five times in a day); a fresh link does not wait.
// {waited_ms, file: {name, sent, taken, still_ms}}, or null while it moves.
function link_stood(state, now)
{
    const waited_ms = oldest_call_ms(state, now);
    const heard_ms = (state.heard_at === null) ? null : now - state.heard_at;
    const stood_ms = link_stood.stood_ms();
    if ((waited_ms < stood_ms) || (heard_ms === null) || (heard_ms >= HEARD_MS)) {
        return null;
    }
    let stood = null;
    for (const id of Object.keys(state.streams)) {
        const stream = state.streams[id];
        if ((stream.carries === null) || (stream.carries === undefined) || (stream.carries.way !== 'to')) {
            continue;
        }
        const still_ms = now - ((stream.taken_at === null) ? stream.opened_at : stream.taken_at);
        if ((stream.sent > stream.taken) && (still_ms >= stood_ms) && ((stood === null) || (still_ms > stood.still_ms))) {
            stood = {name: stream.carries.name, sent: stream.sent, taken: stream.taken, still_ms};
        }
    }
    return (stood === null) ? null : {waited_ms, file: stood};
}

// How long the oldest quick call to it has waited, a call that ran out of time unanswered
// included; 0 when every one is answered
function oldest_call_ms(state, now)
{
    let since = ((state.unanswered_since === null) || (state.unanswered_since === undefined)) ? now : state.unanswered_since;
    for (const id of Object.keys((state.calls === undefined) ? {} : state.calls)) {
        const call = state.calls[id];
        if (remote_unanswered.QUICK.includes(call.method) && (call.at < since)) {
            since = call.at;
        }
    }
    return now - since;
}

link_stood.stood_ms = function () {
    return (process.env.SERVICEMAN_STOOD_MS === undefined) ? STOOD_MS : parseInt(process.env.SERVICEMAN_STOOD_MS, 10);
};
link_stood.HEARD_MS = HEARD_MS;

module.exports = link_stood;
