const remote_tags = require('./remote_tags');

// The picture of one remote the control page reads. `logline` is the config's, null when this
// host sends nobody's lines anywhere.
function view_from_remote(remote, now, logline)
{
    const state = remote.state;
    const at = ((now === undefined) ? Date.now() : now);
    return {
        name: remote.name,
        title: remote.title,
        tags: remote_tags(remote),
        // Which of them the machine said about itself, and which the config gives it
        tags_declared: state.declared,
        phase: state.phase,
        address: state.address,
        agent_version: state.agent_version,
        agent_built: ((state.agent_built === undefined) ? null : state.agent_built),
        update_refused: ((state.update_refused === undefined) ? null : state.update_refused),
        connected_at: state.connected_at,
        uptime_ms: (((state.phase === 'offline') || (state.connected_at === null)) ? null : at - state.connected_at),
        left_at: state.left_at,
        latency_ms: state.latency_ms,
        throughput_bps: state.throughput_bps,
        // The names this machine's door may serve, and how much is riding its link right now
        inbound: ((remote.inbound === undefined) ? [] : remote.inbound),
        streams: Object.keys(state.streams).length,
        machine: machine_of(state),
        error: state.last_error,
        // Where its lines go: whether they are meant to, where to, from when, and why not
        // Whether its door routes by a table of its own, and whether it holds the one written
        // for it now; null from an agent too old to route
        doors: (((state.resources === null) || (state.resources === undefined) || (state.resources.doors === undefined)) ? null : {
            told: ((state.doors_told === undefined) ? null : state.doors_told),
            wanted: ((state.doors_wanted === undefined) ? null : state.doors_wanted),
            peer: ((state.doors_peer === undefined) ? null : state.doors_peer),
            error: ((state.doors_error === undefined) ? null : state.doors_error),
        }),
        logline: {
            logs: ((remote.logs === undefined) ? 'off' : remote.logs),
            dirs: ((remote.log_dirs === undefined) ? [] : remote.log_dirs),
            endpoint: (((logline === undefined) || (logline === null)) ? null : logline.endpoint),
            // Where Logline's viewer is, for the page to open; null when the config does not say
            ui: (((logline === undefined) || (logline === null)) ? null : logline.ui),
            told: ((state.logline_told !== null) && (state.logline_told !== undefined)),
            floor: ((state.logline_floor === undefined) ? null : state.logline_floor),
            error: ((state.logline_error === undefined) ? null : state.logline_error),
            // The addresses its token works from, and when Logline issued it
            ips: ((state.logline_ips === undefined) ? null : state.logline_ips),
            issued_at: ((state.logline_issued_at === undefined) ? null : state.logline_issued_at),
            // What the machine says about its sending; null from an agent that does not say
            status: (((state.stats === null) || (state.stats === undefined) || (state.stats.logline === undefined)) ? null : state.stats.logline),
        },
    };
}

// The machine as one object: what it is (the hello) and what moves (the heartbeat), merged
// here so every reader sees one fresh picture. The wire keeps its two halves; nothing
// downstream has to know. A machine that never dialled in is null; a value its agent is too
// old to say is null too.
function machine_of(state)
{
    const resources = state.resources;
    if (resources === null) {
        return null;
    }
    const stats = state.stats;
    return {
        hostname: resources.hostname,
        user: ((resources.user === undefined) ? null : resources.user),
        os: ((resources.os === undefined) ? null : resources.os),
        platform: resources.platform,
        arch: resources.arch,
        node: resources.node,
        dir: ((resources.dir === undefined) ? null : resources.dir),
        docker: resources.docker,
        // null says the agent is from before the naming — not the same as an empty list
        can: (Array.isArray(resources.can) ? resources.can : null),
        // The addresses others may see it at; null from an agent that does not say
        addresses: (Array.isArray(resources.addresses) ? resources.addresses : null),
        cpu: resources.cpu,
        mem: {total: resources.mem.total, free: ((stats === null) ? null : stats.mem_free)},
        disk: {path: resources.disk.path, total: resources.disk.total, free: ((stats === null) ? resources.disk.free : stats.disk_free)},
        // Every disk together; null from an agent that does not count them yet
        disks: (((stats === null) || (stats.disks === undefined)) ? null : stats.disks),
        uptime_ms: ((stats === null) ? null : stats.uptime_ms),
        load: ((stats === null) ? null : stats.load),
        // null from an agent that does not measure it yet
        cpu_busy: (((stats === null) || (stats.cpu_busy === undefined)) ? null : stats.cpu_busy),
        battery: (((stats === null) || (stats.battery === undefined)) ? null : stats.battery),
        temperature: (((stats === null) || (stats.temperature === undefined)) ? null : stats.temperature),
        // Where the numbers above come from: servermon running, off or silent. null from an
        // agent that measured them itself
        servermon: (((stats === null) || (stats.servermon === undefined)) ? null : stats.servermon),
        updates: (((stats === null) || (stats.updates === undefined)) ? null : stats.updates),
        // The door on that machine: where it is and who may knock, as the file says right now.
        // null is no door — an agent from before them, or one whose link is not up.
        door: (((stats === null) || (stats.door === undefined)) ? null : stats.door),
    };
}

module.exports = view_from_remote;
