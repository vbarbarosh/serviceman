const forward_join = require('./forward_join');

// The speed is what moved over this many seconds, sampled once a second
const SPEED_SECONDS = 3;
const BUCKET_MS = 5000;
// Ten minutes of buckets
const HISTORY_MAX = 120;

// One look a second at every forward's bytes. A forward with no traffic has speeds of 0 and a
// zero in the history for each 5-second bucket closed since its first look.
function forwards_sample(app, now)
{
    for (const forward of app.config.forwards) {
        forward_sample(forward_join.counts(app, forward.label), now);
    }
}

function forward_sample(counts, now)
{
    counts.samples.push({at: now, sent: counts.bytes_sent, back: counts.bytes_back});
    if (counts.samples.length > SPEED_SECONDS + 1) {
        counts.samples.shift();
    }
    const first = counts.samples[0];
    counts.speed_sent = bytes_per_second_from(counts.bytes_sent - first.sent, now - first.at);
    counts.speed_back = bytes_per_second_from(counts.bytes_back - first.back, now - first.at);
    bucket_sample(counts, now);
}

// A bucket is measured from the first look in it to the first look in the next one. A timer
// that stalled over several buckets spreads what moved evenly over each of them.
function bucket_sample(counts, now)
{
    const start = now - (now % BUCKET_MS);
    const bucket = counts.bucket;
    if ((bucket !== null) && (bucket.start === start)) {
        return;
    }
    counts.bucket = {start, at: now, sent: counts.bytes_sent, back: counts.bytes_back};
    if (bucket === null) {
        return;
    }
    const closed = Math.min((start - bucket.start)/BUCKET_MS, HISTORY_MAX);
    const sent = bytes_per_second_from(counts.bytes_sent - bucket.sent, now - bucket.at);
    const back = bytes_per_second_from(counts.bytes_back - bucket.back, now - bucket.at);
    for (let i = 0; i < closed; ++i) {
        history_push(counts.history_sent, sent);
        history_push(counts.history_back, back);
    }
}

function history_push(history, value)
{
    history.push(value);
    if (history.length > HISTORY_MAX) {
        history.shift();
    }
}

// Whole bytes per second; no time passed, or a clock set back, is no speed
function bytes_per_second_from(bytes, ms)
{
    if (ms <= 0) {
        return 0;
    }
    return Math.round(bytes*1000/ms);
}

module.exports = forwards_sample;
