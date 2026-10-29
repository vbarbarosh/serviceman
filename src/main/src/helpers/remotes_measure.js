const format_duration_ms = require('../../../helpers/format_duration_ms');
const link_reset = require('./link_reset');
const link_stood = require('./link_stood');
const log_event = require('./log_event');
const remote_measure = require('./remote_measure');

// A machine says it is there by itself, every few seconds. So this clock is not a poll: it
// looks at what has gone quiet, asks that one whether it is still there, and gives up on it
// when nothing has come back for long enough that no blink could explain it.
//
// Nothing is written down for a ping that failed. One round trip that did not come back is not
// an event — the deadline below is what decides, and that gets the line.
const QUIET_MS = 25000;
const GONE_MS = 60000;
// How often the throughput is measured, whether or not the machine has been quiet: it is a
// real transfer and it is nobody's evidence of life
const THROUGHPUT_EVERY_MS = 600000;

async function remotes_measure(app)
{
    const jobs = [];
    for (const remote of app.remotes) {
        if (remote.state.phase !== 'online') {
            continue;
        }
        jobs.push(look_at(app, remote));
    }
    await Promise.all(jobs);
}

async function look_at(app, remote)
{
    const state = remote.state;
    const silent = Date.now() - ((state.heard_at === null) ? state.connected_at : state.heard_at);
    if (silent >= GONE_MS) {
        const socket = state.socket;
        state.gone_reason = `nothing heard for ${Math.round(silent/1000)}s`;
        if (socket !== null) {
            socket.destroy();
        }
        return;
    }
    // Heard, and still its calls wait behind a file whose bytes stand: the way to it is stuck,
    // and a fresh link is what moves again
    const now = Date.now();
    const stood = link_stood(state, now);
    if (stood !== null) {
        link_reset(app, remote, 'the way to it stood', {
            waited: format_duration_ms(stood.waited_ms),
            file: stood.file.name,
            sent: stood.file.sent,
            taken: stood.file.taken,
            still: format_duration_ms(stood.file.still_ms),
        });
        return;
    }
    const measured = (state.measured_at === null) ? 0 : state.measured_at;
    const owed = (Date.now() - measured >= THROUGHPUT_EVERY_MS);
    const quiet = (silent >= QUIET_MS);
    if ((quiet === false) && (owed === false)) {
        return;
    }
    // The link this goes out on is held: by the time it fails the remote may have no link at
    // all, or a new one that dialled in while this was in flight
    const socket = state.socket;
    try {
        await remote_measure(app, remote);
    }
    catch {
        // Not a word for a measurement that failed: it is one unanswered question, and the
        // deadline above is what turns a quiet machine into a machine that is gone. The line
        // below is about the silence, so it is written only when silence is what was asked
        // about, and only the first time.
        if (quiet && (state.socket === socket) && (socket !== null)) {
            log_quiet(app, remote, silent);
        }
    }
}

// Said once as a machine goes quiet, and not again while it stays that way — the page shows
// the same thing, and a line every ten seconds is not news
function log_quiet(app, remote, silent)
{
    if (remote.state.quiet_said === true) {
        return;
    }
    remote.state.quiet_said = true;
    log_event(app, 'remote_quiet', {remote: remote.name, silent: `${Math.round(silent/1000)}s`, then: 'waiting for it'});
}

module.exports = remotes_measure;
