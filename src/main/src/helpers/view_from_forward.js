const forward_join = require('./forward_join');

// One forward as the page shows it: the two ends, whether the near one listens and where, what
// stands in its way now, and what went through it
function view_from_forward(app, forward)
{
    const from = app.remote_by_name[forward.from.remote];
    const to = app.remote_by_name[forward.to.remote];
    const said = (((from === undefined) || (from.state.forwards_said === null)) ? undefined : from.state.forwards_said[forward.name]);
    const counts = forward_join.counts(app, forward.name);
    return Object.assign({}, forward, {
        // Where the agent listens, its ~ written out; null while it does not
        at: (((said === undefined) || (said.error !== null)) ? null : said.at),
        problem: problem_of(forward, from, to, said),
        open: counts.open,
        total: counts.total,
        bytes_to: counts.bytes_to,
        bytes_from: counts.bytes_from,
        error: counts.error,
        error_at: counts.error_at,
    });
}

// The one thing that keeps a connection from going through right now, or null for none. The
// order is the order a connection meets them in.
function problem_of(forward, from, to, said)
{
    if (forward.off) {
        return 'set aside';
    }
    const can = (((from.state.resources === null) || (from.state.resources.can === undefined)) ? [] : from.state.resources.can);
    if ((from.state.phase === 'online') && (can.includes('forwards') === false)) {
        return `the agent on ${from.name} is older than forwards — update it`;
    }
    if (said === undefined) {
        return ((from.state.phase === 'online') ? `${from.name} is being told` : `${from.name} is offline`);
    }
    if (said.error !== null) {
        return `${from.name} cannot listen: ${said.error}`;
    }
    if (from.state.phase !== 'online') {
        return `${from.name}'s link is down: it listens, and refuses each connection until it is back`;
    }
    if (to.state.phase !== 'online') {
        return `${to.name} is offline`;
    }
    return null;
}

module.exports = view_from_forward;
