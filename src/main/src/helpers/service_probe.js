const agent_reset = require('./agent_reset');
const docker_probe = require('./docker_probe');
const instance_stopped = require('./instance_stopped');
const log_event = require('./log_event');
const remote_candidates = require('./remote_candidates');
const service_waits_for_remote = require('./service_waits_for_remote');
const shell_probe_on = require('./shell_probe_on');

// On boot: instances that are already up stay up, with their idle clocks started now and the
// time they came up as the last serviceman wrote it down. An instance the link lost and found
// again keeps its clocks: the container never stopped.
async function service_probe(app, service)
{
    if ((service.type === 'external') || service_waits_for_remote(app, service)) {
        return;
    }
    for (const instance of service.state.instances) {
        const found = await found_anywhere(app, service, instance);
        const started_before = instance.started_before;
        instance.started_before = null;
        if (found === null) {
            // It was out of reach, and now that it can be looked at, it is not there
            if (instance.phase === 'lost') {
                instance_stopped(instance);
            }
            continue;
        }
        if ((instance.phase !== 'lost') || (instance.last_activity_at === null)) {
            instance.started_at = (started_before === null) ? Date.now() : started_before;
            instance.last_activity_at = Date.now();
        }
        instance.phase = 'running';
        // It is up, so whatever went wrong last time is history — a running service with an
        // old error on its page is a service somebody goes looking for a fault in
        instance.last_error = null;
        service.state.last_error = null;
        instance.remote = found.remote.name;
        instance.upstream = found.upstream;
        // Reached through the link of the machine it was found on — the pool it had was for
        // wherever it ran before, or for nowhere
        agent_reset(app, service, instance);
        log_event(app, 'service_adopt_ok', {service: service.name, instance: instance.slot, remote: found.remote.name, upstream: `${found.upstream.host}:${found.upstream.port}`});
    }
}

// A container of this instance may be on any machine the service is allowed to run on; the
// first one that has it keeps it, and that is where the instance now lives
async function found_anywhere(app, service, instance)
{
    for (const remote of remote_candidates(app, service)) {
        if (remote.state.phase !== 'online') {
            continue;
        }
        const upstream = await driver_probe(app, remote, service, instance);
        if (upstream !== null) {
            return {remote, upstream};
        }
    }
    return null;
}

function driver_probe(app, remote, service, instance)
{
    if (service.type === 'docker') {
        return docker_probe(app, remote, service, instance.slot);
    }
    if ((service.type === 'shell') && (service.image !== null)) {
        return docker_probe(app, remote, service, instance.slot);
    }
    if (service.type === 'shell') {
        return shell_probe_on(app, remote, service, instance);
    }
    return Promise.resolve(null);
}

module.exports = service_probe;
