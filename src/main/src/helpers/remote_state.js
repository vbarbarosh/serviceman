// The mutable half of a remote: the link its agent dials in on, and what it says about itself
function remote_state()
{
    return {
        socket: null,
        phase: 'offline',
        address: null,
        agent_version: null,
        agent_built: null,
        // When it was last asked to fetch a newer agent, so it is not asked on every tick —
        // and what it answered when it would not, so the page can say why it stays old
        update_asked_at: null,
        update_refused: null,
        // The build it ran when last asked, and how many asks in a row it answered and did not
        // take: an agent that says it started and comes back as itself is stuck, whatever it says
        update_asked_build: null,
        update_not_taken: 0,
        // The groups this machine has already told us about, so each one is announced once
        groups: new Set(),
        connected_at: null,
        left_at: null,
        // The last time anything at all came in on this link — a beat, an answer, a line of
        // output. A machine that is talking is a machine nobody has to ask about.
        heard_at: null,
        // What the machine said it was doing when it went, when it said anything — and what
        // this end concluded when it said nothing
        leaving: null,
        gone_reason: null,
        // Whether this end has already said the machine went quiet, so it says it once
        quiet_said: false,
        // What the machine says it is, for as long as it is connected
        declared: [],
        resources: null,
        stats: null,
        // The upgrade running on that machine, if one is: its lines as they arrive, and how it
        // ended. Asked for by hand, cancelled by hand, kept until the next one is asked for.
        apt: {phase: 'idle', lines: [], started_at: null, ended_at: null, error: null},
        // What it was last told about Logline on this link, the moment its collection began
        // there, and why the last telling failed. A telling in flight is here too, so two never
        // overlap.
        logline_told: null,
        logline_floor: null,
        // The door table it said it serves, where its peers reach it, and why the last telling
        // failed. The peer stays when the link goes: a machine away is still somebody's peer.
        doors_told: null,
        doors_wanted: null,
        doors_sending: null,
        doors_peer: null,
        doors_error: null,
        logline_error: null,
        logline_busy: null,
        // The addresses its token was issued for, and when
        logline_ips: null,
        logline_issued_at: null,
        latency_ms: null,
        throughput_bps: null,
        measured_at: null,
        // Its charts as last read, by range: shown while it is away, and kept across links
        metrics: {},
        calls: {},
        next_call_id: 0,
        streams: {},
        next_stream_id: 0,
        last_error: null,
    };
}

module.exports = remote_state;
