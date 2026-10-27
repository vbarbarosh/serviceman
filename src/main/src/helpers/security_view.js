const security_checks = require('./security_checks');

// Worst first: what to mend, what to look at, what is fine, what has nothing to say
const RANK = {bad: 0, warn: 1, ok: 2, none: 3};

// The Security page: a row per machine, a column per check, worst first, the machines away
// last. Built from the last look at each (security_check) and its updates as they are now,
// so an upgrade shows at once rather than at the next look.
//
//     remotes   the machines' views, as the page gets them (view_from_remote)
//     out       {checking, rows: [{remote, name, phase, state, at, checking, mending, error, checks}],
//                counts: {bad, warn}}: the checks to mend and to look at, every machine's
function security_view(app, remotes, now)
{
    const rows = remotes.map(function (view) {
        const seen = app.security.seen.get(view.name);
        const checking = app.security.running.has(view.name);
        // The mend a click started there and that has not ended: its button says so, whoever looks
        const mending = app.security.mending.has(view.name) ? app.security.mending.get(view.name) : null;
        const out = {remote: view.name, name: view.title || view.name, phase: view.phase, state: 'none', at: null, checking, mending, error: null, checks: []};
        if (seen === undefined) {
            return out;
        }
        out.at = seen.at;
        if (seen.error !== undefined) {
            out.error = seen.error;
            return out;
        }
        // A machine away keeps its last look, said as old: nothing of it can be asked now
        out.checks = security_checks(seen, (view.machine === null) ? null : view.machine.updates, now);
        const states = out.checks.map(v => v.state);
        out.state = ['bad', 'warn', 'ok'].find(v => states.includes(v)) || 'none';
        return out;
    });
    rows.sort((a, b) => ((a.phase === 'online') ? 0 : 1) - ((b.phase === 'online') ? 0 : 1) || (RANK[a.state] - RANK[b.state]) || a.name.localeCompare(b.name));
    const counts = {bad: 0, warn: 0};
    for (const row of rows) {
        for (const check of row.checks) {
            if (counts[check.state] !== undefined) {
                counts[check.state]++;
            }
        }
    }
    return {checking: app.security.running.size > 0, rows, counts};
}

module.exports = security_view;
