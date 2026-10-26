const http = require('http');

// The mutable half of a service: the pool of instance slots the handlers drive
function state_from_service(service)
{
    const out = {
        instances: [],
        queue: [],
        requests: 0,
        last_error: null,
        // What was said while it was coming up, for whoever is waiting on the page
        said: [],
        // What serviceman is doing to it right now, in words, when that is nothing the phase
        // can say: fetching the program takes minutes and the service is stopped the whole time
        doing: null,
        // The work serviceman does to it as a whole, which another such work waits for: a new
        // version put in place, the program fetched again. A start is not one of them.
        work: null,
        // How far that work is, from 0 to 1, when it is the kind of work that can be measured,
        // and the numbers behind it in words
        progress: null,
        progress_text: null,
        // Bytes going somewhere for it, as the page draws every copy (service_copy_start): a
        // new version on its way to the machine, an image coming down; null while none
        copy: null,
        // The reading of a download while one is running
        pull: null,
        // Starts that failed in a row, and when serviceman stopped trying because of them
        failures: 0,
        gave_up_at: null,
        stopped_at: null,
        stop_promise: null,
        // Work on its folder that every start waits for: a new version being put in place
        hold_promise: null,
        // How long the last copy took to answer, from the order to start to the first reply.
        // It is what a visitor waits through, and what the autoscaler has to start ahead of.
        cold_start_ms: null,
        scaled_at: null,
        busy_up_since: null,
        busy_down_since: null,
    };
    if (service.type === 'external') {
        // It is up because it is somebody else's business; there is nothing to wait for
        out.instances.push(Object.assign(instance_new(1), {
            phase: 'running',
            // On a machine of ours it is reached through that machine's link: its upstream is
            // an address there, not here
            remote: (service.remotes.length === 0) ? null : service.remotes[0],
            upstream: service.upstream,
            started_at: Date.now(),
            last_activity_at: Date.now(),
        }));
        return out;
    }
    for (let slot = 1; slot <= service.policy.instances.max; slot++) {
        out.instances.push(instance_new(slot));
    }
    return out;
}

function instance_new(slot)
{
    return {
        slot,
        phase: 'stopped',
        remote: null,
        upstream: null,
        started_at: null,
        // When the last serviceman saw this copy come up, read from the counters file; the
        // probe that finds it still running takes it instead of now
        started_before: null,
        stopped_at: null,
        last_activity_at: null,
        last_error: null,
        inflight: 0,
        requests: 0,
        start_promise: null,
        // The start is past what it waits for and at work: a hold waits for it to end, where
        // a start still waiting for the hold would wait for the hold forever
        start_under_way: false,
        stop_promise: null,
        pid: null,
        asked_to_stop: false,
        restarts: 0,
        restart_timer: null,
        // The last line of its own output that was passed to whoever is waiting, so the same
        // lines are not said twice while it comes up
        tail_said: null,
        agent: new http.Agent({keepAlive: true, maxSockets: 128}),
    };
}

module.exports = state_from_service;
