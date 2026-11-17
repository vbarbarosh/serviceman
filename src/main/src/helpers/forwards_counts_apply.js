const forward_join = require('./forward_join');

const COUNT_KEYS = ['open', 'total', 'bytes_sent', 'bytes_back'];

// What a machine's agent says went through the forwards it joins itself (forwards_tell told it
// the far end: on the same machine, or a peer's agent): added to the counts the page shows, the
// same counts forward_join keeps for the ones serviceman carries. A machine counts the forwards
// that show up on it and no others; what cannot be read is left out.
//
//     counts   {label: {open, total, bytes_sent, bytes_back, failed, away}}: the connections open
//              now, what was added since the last telling, the reason of the last failure if
//              there was a new one, and why the last connection went through serviceman, its
//              peer not answering, or null when it went straight
function forwards_counts_apply(app, remote, counts)
{
    if ((counts === null) || (typeof counts !== 'object') || Array.isArray(counts)) {
        return;
    }
    for (const label of Object.keys(counts)) {
        const forward = app.config.forwards.find(v => v.label === label);
        if ((forward === undefined) || (forward.to.remote !== remote.name)) {
            continue;
        }
        const said = counts[label];
        if ((said === null) || (typeof said !== 'object') || (COUNT_KEYS.every(v => Number.isSafeInteger(said[v]) && (said[v] >= 0)) === false)) {
            continue;
        }
        const held = forward_join.counts(app, label);
        // The agent's own open ones, beside those serviceman carries when a peer did not answer
        held.open += said.open - held.open_joined;
        held.open_joined = said.open;
        held.total += said.total;
        held.bytes_sent += said.bytes_sent;
        held.bytes_back += said.bytes_back;
        if ((said.away === null) || (typeof said.away === 'string')) {
            held.peer_away = said.away;
        }
        // The reason is the service's, on the machine it is on
        if (typeof said.failed === 'string') {
            forward_join.failed(app, held, label, `${forward.from.remote}: ${said.failed}`);
        }
    }
}

module.exports = forwards_counts_apply;
