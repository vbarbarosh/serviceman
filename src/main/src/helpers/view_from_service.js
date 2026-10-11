const service_inflight = require('./service_inflight');
const service_phase = require('./service_phase');
const service_redir = require('../service_redir');

// How much of what a service said goes into every status answer. The whole of it is 60 lines
// and the page asks once a second; this is the tail that says what is happening now.
const SAID_LINES = 12;

// The picture of one service the control page and the waiting page read
function view_from_service(service, now)
{
    const state = service.state;
    const at = ((now === undefined) ? Date.now() : now);
    const phase = service_phase(service);
    const storage = [];
    for (const volume of ((service.volumes === undefined) ? [] : service.volumes)) {
        storage.push({kind: volume.kind, source: volume.source, target: volume.target, readonly: volume.readonly});
    }
    const instances = [];
    for (const instance of state.instances) {
        instances.push(view_from_instance(instance, at));
    }
    const running = instances.filter(v => v.phase === 'running');
    const out = {
        name: service.name,
        title: service.title,
        type: service.type,
        source: source_from_service(service),
        remotes: service.remotes,
        publish: {
            hosts: service.hosts,
            port: ((service.port === undefined) ? null : service.port),
            strip_prefix: service.strip_prefix,
        },
        phase,
        redirect: ((service.redirect === undefined) ? null : service.redirect),
        // The address serviceman keeps for it on its own hostname, for the rules that only
        // accept `localhost` — an OAuth callback above all
        redir: ((service.hosts.length === 0) ? null : service_redir(service)),
        // Whether there is anything to fetch again: a program that puts itself in place
        installs: ((service.type === 'shell') && (service.lifecycle.install !== null)),
        // Whether there is an image behind it, and so something a pull could bring
        image: ((service.type === 'docker') ? service.image : null),
        // Work that the phase does not show, and the last of what it printed while doing it,
        // so that a page open on a slow install sees the install rather than a still picture
        doing: ((state.doing === undefined) ? null : state.doing),
        progress: ((state.progress === undefined) ? null : state.progress),
        progress_text: ((state.progress_text === undefined) ? null : state.progress_text),
        said: state.said.slice(-SAID_LINES),
        upstream: ((running.length > 0) ? running[0].upstream : null),
        started_at: oldest_started_at(state.instances),
        stopped_at: state.stopped_at,
        uptime_ms: null,
        idle_ms: newest_idle_ms(state.instances, at),
        stop_in_ms: null,
        instances,
        instances_running: running.length,
        queue: state.queue.length,
        storage,
        cold_start_ms: state.cold_start_ms,
        requests: state.requests,
        inflight: service_inflight(service),
        error: state.last_error,
        failures: state.failures,
        gave_up: state.gave_up_at !== null,
        policy: {
            start: service.policy.start,
            stop_after_idle_ms: service.policy.stop_after_idle_ms,
            start_timeout_ms: service.policy.start_timeout_ms,
            stop_timeout_ms: service.policy.stop_timeout_ms,
            request_timeout_ms: service.policy.request_timeout_ms,
            scale_down_after_ms: service.policy.scale_down_after_ms,
            instances: service.policy.instances,
            concurrency: service.policy.concurrency,
            restart: service.policy.restart,
            warmup: {queue: service.policy.warmup.queue, wait_ms: service.policy.warmup.wait_ms},
            autoscale: service.policy.autoscale,
        },
    };
    if (out.started_at !== null) {
        out.uptime_ms = at - out.started_at;
    }
    if ((phase === 'running') && (out.idle_ms !== null) && (service.policy.stop_after_idle_ms !== null) && (service.policy.start !== 'always')) {
        out.stop_in_ms = Math.max(0, service.policy.stop_after_idle_ms - out.idle_ms);
    }
    return out;
}

// What the service is made of, said in the words of its kind — the image, the command, the
// folder — so the page can show where what runs came from
function source_from_service(service)
{
    if (service.type === 'docker') {
        return {label: 'Image', text: service.image};
    }
    if (service.type === 'shell') {
        const line = (((service.command === undefined) || (service.command === null)) ? service.argv.join(' ') : service.command);
        return {label: 'Command', text: ((service.cwd === null) ? line : `${line} in ${service.cwd}`)};
    }
    return {label: 'Answers at', text: `${service.upstream.host}:${service.upstream.port}`};
}

function view_from_instance(instance, at)
{
    return {
        slot: instance.slot,
        phase: instance.phase,
        remote: instance.remote,
        upstream: ((instance.upstream === null) ? null : `${instance.upstream.host}:${instance.upstream.port}`),
        uptime_ms: ((instance.started_at === null) ? null : at - instance.started_at),
        idle_ms: ((instance.last_activity_at === null) ? null : at - instance.last_activity_at),
        inflight: instance.inflight,
        requests: instance.requests,
        error: instance.last_error,
    };
}

// Since when the service has been up, which is the oldest copy of it that is up now. One that
// is stopped or failed has no say in it: `Up for` is about being up.
function oldest_started_at(instances)
{
    let out = null;
    for (const instance of instances) {
        if ((instance.started_at === null) || ((instance.phase !== 'running') && (instance.phase !== 'lost'))) {
            continue;
        }
        if ((out === null) || (instance.started_at < out)) {
            out = instance.started_at;
        }
    }
    return out;
}

function newest_idle_ms(instances, at)
{
    let out = null;
    for (const instance of instances) {
        if ((instance.phase !== 'running') || (instance.last_activity_at === null)) {
            continue;
        }
        const idle = at - instance.last_activity_at;
        if ((out === null) || (idle < out)) {
            out = idle;
        }
    }
    return out;
}

module.exports = view_from_service;
