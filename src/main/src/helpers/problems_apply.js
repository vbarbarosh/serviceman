const format_duration_ms = require('../../../helpers/format_duration_ms');
const log_event = require('./log_event');

// A problem is shown once it has been seen twice, a check apart: a refusal that lasts one
// batch, a service caught between two of its own restarts, is not one
const HOLD_MS = 50*1000;

// What the checks found, kept as the problems the page shows. Each is said in the log when it
// is first shown and again when it is gone, with how long it lasted.
//
//     found   [{key, kind, remote, subject, cause, fix, since}], since null when unknown
function problems_apply(app, found, now)
{
    const before = app.problems;
    const after = new Map();
    for (const item of found) {
        const was = before.get(item.key);
        const first_seen = (was === undefined) ? now : was.first_seen;
        const shown = ((was !== undefined) && was.shown) || (now - first_seen >= HOLD_MS);
        if (shown && ((was === undefined) || (was.shown === false))) {
            log_event(app, 'problem_begin', {remote: item.remote, subject: item.subject, cause: item.cause});
        }
        after.set(item.key, Object.assign({}, item, {first_seen, shown}));
    }
    for (const [key, was] of before) {
        if ((after.has(key) === false) && was.shown) {
            log_event(app, 'problem_end', {remote: was.remote, subject: was.subject, lasted: format_duration_ms(now - (was.since || was.first_seen))});
        }
    }
    app.problems = after;
}

module.exports = problems_apply;
