const vulnerabilities_items = require('../../../../modules/vulnerabilities/server/vulnerabilities_items');
const vulnerabilities_kept = require('./vulnerabilities_kept');
const vulnerabilities_notes = require('./vulnerabilities_notes');

// One machine's critical CVEs as the pages show them, from its last Security look: each with
// what it hits, what mends it, whether it is new (found after the problems bar was last closed
// on this machine, or never closed), and what Ubuntu's own page adds (its stopgap, the version
// a fix waits in).
//
//     look   the look's vulnerabilities (vulnerabilities_of_remote), or undefined: none yet
//     out    {at, reason, codename, kernel, list, counts: {fix_out, restart, pro, no_fix, new},
//             items: vulnerabilities_items' answer, or null where reason says why}
function vulnerabilities_view(app, name, look)
{
    const counts = {fix_out: 0, restart: 0, pro: 0, no_fix: 0, new: 0};
    if ((look === undefined) || (look === null)) {
        return {at: null, reason: 'not looked at yet', codename: null, kernel: null, list: null, counts, items: null};
    }
    const out = {at: look.at, reason: look.reason, codename: look.codename, kernel: look.kernel, list: look.list, counts, items: null};
    if (look.items === null) {
        return out;
    }
    const kept = vulnerabilities_kept(app);
    out.items = vulnerabilities_items(look.items, {
        codename: look.codename,
        found: kept.found[name] || {},
        seen_at: kept.seen[name] || 0,
        notes: v => vulnerabilities_notes(app, v),
    });
    for (const item of out.items) {
        counts[item.state]++;
        if (item.new) {
            counts.new++;
        }
    }
    return out;
}

module.exports = vulnerabilities_view;
