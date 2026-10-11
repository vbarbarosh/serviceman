const remote_blast = require('./remote_blast');
const remote_call = require('./remote_call');

const BLAST_BYTES = 1024*1024;
const PING_TIMEOUT_MS = 10000;
const THROUGHPUT_EVERY_MS = 600000;

// How far the remote is and how fast the link to it runs: a ping for the delay, then a
// megabyte there and back for the speed. The speed costs traffic, so it is measured rarely.
async function remote_measure(app, remote)
{
    const state = remote.state;
    const time0 = Date.now();
    await remote_call(app, remote, 'ping', {}, PING_TIMEOUT_MS);
    state.latency_ms = Date.now() - time0;
    if ((state.measured_at !== null) && (Date.now() - state.measured_at < THROUGHPUT_EVERY_MS)) {
        return;
    }
    const blast_at = Date.now();
    await remote_blast(app, remote, BLAST_BYTES);
    const took_ms = Math.max(1, Date.now() - blast_at - state.latency_ms);
    state.throughput_bps = Math.round(2*BLAST_BYTES*1000/took_ms);
    state.measured_at = Date.now();
}

module.exports = remote_measure;
