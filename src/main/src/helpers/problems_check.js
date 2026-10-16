const health_of_firewall = require('./health_of_firewall');
const health_of_logline = require('./health_of_logline');
const log_event = require('./log_event');
const problems_apply = require('./problems_apply');
const problems_from_logline = require('./problems_from_logline');
const problems_of_remote = require('./problems_of_remote');
const problems_of_services = require('./problems_of_services');

// A firewall is asked less often than the rest: two ufw runs as root, for a state that changes
// by hand
const FIREWALL_EVERY_MS = 5*60*1000;

// Everything serviceman can tell is wrong, looked at once: machines that dropped off, lines
// Logline does not get, containers that are down or will not come back, copies that do not
// answer. Run on a clock and after an upgrade; what it finds is what the page shows. One
// check at a time: asked while one runs, the answer is that one. What it asked and heard, the
// good with the bad, is kept for the Health page (app.health_seen).
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
    const seen = [];
    const asked = [];
    const before = app.health_seen.items;
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
        asked.push(problems_of_remote(app, remote).then(function (answer) {
            found.push(...answer.problems);
            seen.push(...answer.seen);
        }, function (error) {
            log_event(app, 'problems_check_error', {remote: remote.name, reason: error.message});
            seen.push([`docker:${remote.name}`, {state: 'none', text: 'not asked', detail: `Docker there did not answer: ${error.message}`}]);
            // Not looked at this time is not mended: what was wrong with its containers stays
            for (const item of app.problems.values()) {
                if ((item.kind === 'container') && (item.remote === remote.name)) {
                    found.push(item);
                }
            }
        }));
        const key = `firewall:${remote.name}`;
        const last = before.get(key);
        if ((last !== undefined) && (now - last.at < FIREWALL_EVERY_MS)) {
            seen.push([key, last]);
        }
        else {
            asked.push(health_of_firewall(app, remote).then(function (item) {
                seen.push([key, Object.assign({at: now}, item)]);
            }));
        }
    }
    asked.push(problems_of_services(app).then(function (answer) {
        found.push(...answer.problems);
        seen.push(...answer.seen);
    }));
    asked.push(health_of_logline(app.config.logline).then(function (list) {
        seen.push(...list);
        // Logline away is every machine's lines going nowhere, or Open Logline refused
        for (const [key, item] of list) {
            if (item.state === 'bad') {
                found.push({
                    key: key.replace(/^logline:/, 'logline_down:'),
                    kind: 'logline',
                    remote: null,
                    subject: ((key === 'logline:ui') ? 'Logline\'s viewer does not answer' : 'Logline does not answer'),
                    cause: item.cause,
                    fix: 'See that Logline runs on its machine: its containers on that machine\'s Docker tab.',
                    since: null,
                });
            }
        }
    }));
    await Promise.all(asked);
    problems_apply(app, found, now);
    app.health_seen = {checked_at: now, items: new Map(seen)};
}

module.exports = problems_check;
