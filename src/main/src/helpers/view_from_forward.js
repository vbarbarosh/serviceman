const forward_join = require('./forward_join');

// One forward as the page shows it: the two ends, whether the near one listens and where, what
// stands in its way now, and what went through it and how fast
function view_from_forward(app, forward)
{
    const from = app.remote_by_name[forward.from.remote];
    const to = app.remote_by_name[forward.to.remote];
    const said = (((to === undefined) || (to.state.forwards_said === null)) ? undefined : to.state.forwards_said[forward.name]);
    const counts = forward_join.counts(app, forward.name);
    const now = now_of(forward, from, to, said);
    return Object.assign({}, forward, {
        // Where the agent listens, its ~ written out; null while it does not
        at: (((said === undefined) || (said.error !== null)) ? null : said.at),
        // Where it stands, as a word the page shows on the forward's one line, and in full
        state: now.state,
        problem: now.problem,
        open: counts.open,
        total: counts.total,
        bytes_sent: counts.bytes_sent,
        bytes_back: counts.bytes_back,
        // Bytes per second over the last 3 seconds, and over each 5-second bucket of the last
        // 10 minutes, oldest first, the one in progress left out (forwards_sample)
        speed_sent: counts.speed_sent,
        speed_back: counts.speed_back,
        history_sent: counts.history_sent,
        history_back: counts.history_back,
        error: counts.error,
        error_at: counts.error_at,
    });
}

// The one thing that keeps a connection from going through right now, in full, or null for
// none, and a word for it. The order is the order a connection meets them in: first the machine
// it shows up on, which listens, then the one the service is on.
function now_of(forward, from, to, said)
{
    if (forward.off) {
        return {state: 'aside', problem: 'set aside'};
    }
    const can = (((to.state.resources === null) || (to.state.resources.can === undefined)) ? [] : to.state.resources.can);
    if ((to.state.phase === 'online') && (can.includes('forwards') === false)) {
        return {state: 'old_agent', problem: `the agent on ${to.name} is older than forwards — update it`};
    }
    if (said === undefined) {
        return ((to.state.phase === 'online') ? {state: 'telling', problem: `${to.name} is being told`} : {state: 'to_offline', problem: `${to.name} is offline`});
    }
    if (said.error !== null) {
        return {state: 'cannot_listen', problem: `${to.name} cannot listen: ${said.error}`};
    }
    if (to.state.phase !== 'online') {
        return {state: 'link_down', problem: `${to.name}'s link is down: it listens, and refuses each connection until it is back`};
    }
    if (from.state.phase !== 'online') {
        return {state: 'from_offline', problem: `${from.name} is offline`};
    }
    return {state: 'ready', problem: null};
}

module.exports = view_from_forward;
