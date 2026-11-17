// What went through the streams this agent joins itself, by name, since serviceman was last
// told: a forward or a mount whose two ends this agent holds, one on this machine and one on
// this machine too or behind a peer's agent. serviceman carries none of their bytes, so it
// hears of them only from here, every few seconds (agent_serve). One counter for the forwards,
// one for the mounts.
//
//     const counts = agent_stream_counts();
//     counts.join('loki', near, far);      both piped, half open, counted until either closes
//     counts.failed('loki', 'connect ECONNREFUSED 127.0.0.1:3100');
//     counts.away('loki', '100.64.0.20:7303: no answer within 3 s');   the peer, so the link took it
//     counts.keep(['loki']);               every other name forgotten
//     counts.take();                       {loki: {open, total, bytes_sent, bytes_back, failed, away}}, or null
//     counts.retell();                     a new link hears the open ones at its first telling
function agent_stream_counts()
{
    const counts = {};
    return {
        join: function (name, near, far) {
            join(counts, name, near, far);
        },
        failed: function (name, reason) {
            counts_of(counts, name).failed = reason;
        },
        away: function (name, reason) {
            counts_of(counts, name).away = reason;
        },
        keep: function (names) {
            for (const name of Object.keys(counts)) {
                if (names.includes(name) === false) {
                    delete counts[name];
                }
            }
        },
        take: function () {
            return take(counts);
        },
        retell: function () {
            for (const name of Object.keys(counts)) {
                counts[name].told_open = null;
                counts[name].told_away = undefined;
            }
        },
    };
}

// The two ends joined byte for byte until either closes. The far end refused or broke: the
// near one goes with it, and serviceman hears why.
function join(counts, name, near, far)
{
    const found = counts_of(counts, name);
    found.away = null;
    found.open++;
    found.total++;
    near.on('data', function (chunk) {
        found.bytes_sent += chunk.length;
    });
    far.on('data', function (chunk) {
        found.bytes_back += chunk.length;
    });
    far.on('error', function (error) {
        found.failed = error.message;
        near.destroy();
    });
    near.on('error', function () {
        far.destroy();
    });
    let closed = 0;
    function close_one() {
        closed++;
        if (closed === 2) {
            found.open--;
        }
    }
    near.on('close', close_one);
    far.on('close', close_one);
    near.pipe(far);
    far.pipe(near);
}

function counts_of(counts, name)
{
    if (counts[name] === undefined) {
        counts[name] = {open: 0, total: 0, bytes_sent: 0, bytes_back: 0, failed: null, away: null, told_open: null, told_away: undefined};
    }
    return counts[name];
}

// What went through since the last time: the connections open now and what was added since,
// the reason of the last failure if there was a new one, and why the last connection went over
// the link, or null when it went straight; null when nothing moved. What is taken is not
// counted again.
function take(counts)
{
    let out = null;
    for (const name of Object.keys(counts)) {
        const found = counts[name];
        const moved = (found.total !== 0) || (found.bytes_sent !== 0) || (found.bytes_back !== 0) || (found.failed !== null) || (found.open !== found.told_open) || (found.away !== found.told_away);
        if (moved === false) {
            continue;
        }
        out = (out === null) ? {} : out;
        out[name] = {open: found.open, total: found.total, bytes_sent: found.bytes_sent, bytes_back: found.bytes_back, failed: found.failed, away: found.away};
        Object.assign(found, {total: 0, bytes_sent: 0, bytes_back: 0, failed: null, told_open: found.open, told_away: found.away});
    }
    return out;
}

module.exports = agent_stream_counts;
