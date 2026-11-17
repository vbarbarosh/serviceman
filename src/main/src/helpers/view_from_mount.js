const mount_join = require('./mount_join');
const remote_can = require('./remote_can');
const stream_peer = require('./stream_peer');

// One mount as the page shows it: the two ends, where it stands on the machine it is mounted on,
// as that machine last said, what stands in its way now, and what went through it
function view_from_mount(app, mount)
{
    const to = app.remote_by_name[mount.to.remote];
    const from = mount.from.here ? null : app.remote_by_name[mount.from.remote];
    const said = said_of(mount, to);
    const counts = mount_join.counts(app, mount.label);
    const now = now_of(mount, from, to, said);
    const straight = (from !== null) && (to !== undefined) && (stream_peer(app, to, mount.from.remote) !== null);
    return Object.assign({}, mount, {
        // A word the page shows on the mount's line, and in full what keeps it from working
        state: now.state,
        problem: now.problem,
        // How sshfs reaches the folder: 'straight', to the agent of the folder's machine, or
        // 'serviceman', through serviceman's links (mounts_tell); and why, when it could go
        // straight and its agent's last connection did not, the peer not answering
        way: ((counts.peer_away === null) && straight) ? 'straight' : 'serviceman',
        way_why: straight ? counts.peer_away : null,
        // Who holds it open, for a mount that waits for them to let go before it changes
        users: ((said === undefined) || (Array.isArray(said.users) === false)) ? [] : said.users,
        said_at: (to === undefined) ? null : to.state.mounts_said_at,
        open: counts.open,
        total: counts.total,
        bytes_sent: counts.bytes_sent,
        bytes_back: counts.bytes_back,
        error: counts.error,
        error_at: counts.error_at,
    });
}

function said_of(mount, to)
{
    if ((to === undefined) || (to.state.mounts_said === null)) {
        return undefined;
    }
    return to.state.mounts_said.items.find(v => v.label === mount.label);
}

// The one thing that keeps it from working, in full, or null for none, and a word for it: first
// the machine it is mounted on, then what that machine said, then the folder's own machine
function now_of(mount, from, to, said)
{
    if (mount.off) {
        return {state: 'aside', problem: 'set aside: not mounted'};
    }
    if ((to === undefined) || (to.state.phase !== 'online')) {
        return {state: 'away', problem: `${mount.to.remote} is offline; it is mounted once its agent dials in`};
    }
    if (remote_can(to, 'mounts') === false) {
        return {state: 'old', problem: `the agent on ${mount.to.remote} is older than mounts — update it`};
    }
    // A machine away has not said what it can: it is not called old for that
    if ((from !== null) && (from.state.resources !== null) && (remote_can(from, 'mounts') === false)) {
        return {state: 'old', problem: `the agent on ${mount.from.remote} is older than mounts — update it`};
    }
    if (said === undefined) {
        return {state: 'waiting', problem: (to.state.mounts_error === null) ? `told to ${mount.to.remote}, no answer yet` : `${mount.to.remote}: ${to.state.mounts_error}`};
    }
    // In the machine's own words, which are about itself: the page names it
    if (said.state !== 'mounted') {
        return {state: said.state, problem: (said.error === undefined) ? null : `${mount.to.remote}: ${said.error}`};
    }
    if ((from !== null) && (from.state.phase !== 'online')) {
        return {state: 'mounted', problem: `${mount.from.remote} is offline: the folder answers nothing until it is back`};
    }
    return {state: 'mounted', problem: null};
}

module.exports = view_from_mount;
