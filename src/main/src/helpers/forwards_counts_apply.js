const forward_join = require('./forward_join');

const COUNT_KEYS = ['open', 'total', 'bytes_sent', 'bytes_back'];

// What a machine's agent says went through the forwards it joins itself, both ends its own
// (forwards_tell told it the far end): added to the counts the page shows, the same counts
// forward_join keeps for the ones serviceman carries. A machine counts its own such forwards
// and no others; what cannot be read is left out.
//
//     counts   {label: {open, total, bytes_sent, bytes_back, failed}}: the connections open now,
//              what was added since the last telling, and the reason of the last failure if
//              there was a new one
function forwards_counts_apply(app, remote, counts)
{
    if ((counts === null) || (typeof counts !== 'object') || Array.isArray(counts)) {
        return;
    }
    for (const label of Object.keys(counts)) {
        const forward = app.config.forwards.find(v => v.label === label);
        if ((forward === undefined) || (forward.to.remote !== remote.name) || (forward.from.remote !== remote.name)) {
            continue;
        }
        const said = counts[label];
        if ((said === null) || (typeof said !== 'object') || (COUNT_KEYS.every(v => Number.isSafeInteger(said[v]) && (said[v] >= 0)) === false)) {
            continue;
        }
        const held = forward_join.counts(app, label);
        held.open = said.open;
        held.total += said.total;
        held.bytes_sent += said.bytes_sent;
        held.bytes_back += said.bytes_back;
        if (typeof said.failed === 'string') {
            forward_join.failed(app, held, label, `${remote.name}: ${said.failed}`);
        }
    }
}

module.exports = forwards_counts_apply;
