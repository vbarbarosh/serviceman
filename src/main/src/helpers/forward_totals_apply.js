const forward_join = require('./forward_join');

// The forwards take back what the last serviceman counted. It is added, not set: a connection
// may have been counted already, since the doors open before the file is read.
function forward_totals_apply(app, saved)
{
    for (const name of Object.keys(saved)) {
        const kept = saved[name];
        if ((kept === null) || (typeof kept !== 'object')) {
            continue;
        }
        const counts = forward_join.counts(app, name);
        for (const key of ['total', 'bytes_sent', 'bytes_back']) {
            if (Number.isFinite(kept[key])) {
                counts[key] += kept[key];
            }
        }
    }
}

module.exports = forward_totals_apply;
