const remote_unanswered = require('./remote_unanswered');

// How long a call may wait, and a file's bytes stand, before the way to a machine is taken to
// stand: a file keeps about a second of its pace on its way (tunnel_stream), so a call waits
// about that behind it; half a minute is no link that moves
// (SERVICEMAN_STOOD_MS, for a test that cannot wait half a minute)
const STOOD_MS = 30000;
// A machine heard this recently is one whose way back works: it says its numbers every 5 s
const HEARD_MS = 8000;

// The way to a machine does not carry when a quick call has waited STOOD_MS for its answer,
// the machine itself is still heard, and a file going to it has bytes it has not taken: bytes
// that took none for STOOD_MS (they stood), or bytes sent to it STOOD_MS ago and not taken yet
// (they fell behind), however recently others were. Its link is stuck in one direction:
// waiting for it took 1½ to 4 minutes on 2026-10-29 (one server, five times in a day), and on
// 2026-11-04 a screen recording on its way to the same server moved now and then, never still
// for half a minute, while its calls waited 2 minutes and more; a fresh link does not wait.
// {waited_ms, file: {name, sent, taken, late, still_ms}, behind}, or null while it moves: late
// what it had sent STOOD_MS ago and has not taken, behind whether that alone says so, its bytes
// having moved within STOOD_MS.
function link_stood(state, now)
{
    const waited_ms = oldest_call_ms(state, now);
    const heard_ms = (state.heard_at === null) ? null : now - state.heard_at;
    const stood_ms = link_stood.stood_ms();
    if ((waited_ms < stood_ms) || (heard_ms === null) || (heard_ms >= HEARD_MS)) {
        return null;
    }
    let found = null;
    for (const id of Object.keys(state.streams)) {
        const stream = state.streams[id];
        if ((stream.carries === null) || (stream.carries === undefined) || (stream.carries.way !== 'to') || (stream.sent <= stream.taken)) {
            continue;
        }
        const still_ms = now - ((stream.taken_at === null) ? stream.opened_at : stream.taken_at);
        const late = Math.max(0, ((stream.sent_by === undefined) ? 0 : stream.sent_by(now - stood_ms)) - stream.taken);
        if ((still_ms < stood_ms) && (late === 0)) {
            continue;
        }
        const file = {name: stream.carries.name, sent: stream.sent, taken: stream.taken, late, still_ms};
        if ((found === null) || (file.still_ms > found.still_ms)) {
            found = file;
        }
    }
    return (found === null) ? null : {waited_ms, file: found, behind: (found.still_ms < stood_ms)};
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
