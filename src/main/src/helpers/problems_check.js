const log_event = require('./log_event');
const problems_apply = require('./problems_apply');
const problems_from_logline = require('./problems_from_logline');
const problems_of_remote = require('./problems_of_remote');
const problems_of_services = require('./problems_of_services');

// Everything serviceman can tell is wrong, looked at once: machines that dropped off, lines
// Logline does not get, containers that are down or will not come back, copies that do not
// answer. Run on a clock and after an upgrade; what it finds is what the page shows. One
// check at a time: asked while one runs, the answer is that one.
function problems_check(app)
{
    if (app.problems_check === null) {
        app.problems_check = check(app).finally(function () {
            app.problems_check = null;
        });
    }
    return app.problems_check;
}

async function check(app)
{
    const now = Date.now();
    const found = [];
    const asked = [];
    for (const remote of app.remotes) {
        const state = remote.state;
        if (state.phase !== 'online') {
            // Only a machine that was here and went: one that never dialled in is not missed
            if (state.left_at !== null) {
                found.push({
                    key: `remote_offline:${remote.name}`,
                    kind: 'remote',
                    remote: remote.name,
                    subject: `${remote.title || remote.name} is offline`,
                    cause: `its agent is not dialled in${(state.last_error === null) ? '' : `: ${state.last_error}`}`,
                    fix: 'See that the machine is up and its agent runs: systemctl status serviceman-agent there.',
                    since: state.left_at,
                });
            }
            continue;
        }
        const stats = state.stats;
        found.push(...problems_from_logline(remote.name, (((stats === null) || (stats === undefined)) ? null : stats.logline), now));
        asked.push(problems_of_remote(app, remote).then(function (list) {
            found.push(...list);
        }, function (error) {
            log_event(app, 'problems_check_error', {remote: remote.name, reason: error.message});
            // Not looked at this time is not mended: what was wrong with its containers stays
            for (const item of app.problems.values()) {
                if ((item.kind === 'container') && (item.remote === remote.name)) {
                    found.push(item);
                }
            }
        }));
    }
    asked.push(problems_of_services(app).then(function (list) {
        found.push(...list);
    }));
    await Promise.all(asked);
    problems_apply(app, found, now);
}

module.exports = problems_check;
