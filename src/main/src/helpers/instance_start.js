const agent_reset = require('./agent_reset');
const docker_start = require('./docker_start');
const format_seconds = require('../../../helpers/format_seconds');
const log_event = require('./log_event');
const log_group = require('./log_group');
const log_words = require('../../../helpers/log_words');
const pool_pump = require('./pool_pump');
const remote_candidates = require('./remote_candidates');
const remote_reserve = require('./remote_reserve');
const service_gave_up = require('./service_gave_up');
const shell_start_on = require('./shell_start_on');
const wait_http_answer = require('./wait_http_answer');

// Starts one instance and returns only once the service answers; waiting requests get it at once
function instance_start(app, service, instance)
{
    if (instance.phase === 'running') {
        return Promise.resolve(instance);
    }
    if (instance.start_promise !== null) {
        return instance.start_promise;
    }
    const out = log_group(() => start_after_stop(app, service, instance));
    instance.start_promise = out;
    function clear() {
        instance.start_promise = null;
    }
    out.then(clear, clear);
    return out;
}

async function start_after_stop(app, service, instance)
{
    if (instance.stop_promise !== null) {
        await instance.stop_promise.catch(function () {});
    }
    if (service.state.stop_promise !== null) {
        await service.state.stop_promise.catch(function () {});
    }
    if (service_gave_up(service)) {
        // Nothing has changed since it last failed, so this would be the same work and the same
        // end. What clears it: a person asking, its machine coming back, its definition edited.
        throw new Error(service.state.last_error);
    }
    const time0 = Date.now();
    service.state.said = [];
    log_event(app, 'service_start_begin', {service: service.name, instance: instance.slot, type: service.type, of: service.remotes});
    instance.phase = 'starting';
    instance.last_error = null;
    service.state.last_error = null;
    // A machine is reserved before anything is started, and a machine that will not take it is
    // crossed off and the next one tried — that is what a list of remotes is for
    const refused = [];
    for (;;) {
        try {
            const remote = remote_reserve(app, service, instance, refused);
            return await start_on(app, service, instance, remote, time0);
        }
        catch (error) {
            if ((instance.remote !== null) && (refused.includes(instance.remote) === false) && more_to_try(app, service, refused, instance)) {
                log_event(app, 'service_start_retry', {service: service.name, instance: instance.slot, remote: instance.remote, reason: error.message});
                refused.push(instance.remote);
                continue;
            }
            instance.phase = 'failed';
            instance.upstream = null;
            instance.last_error = error.message;
            service.state.last_error = error.message;
            service.state.failures++;
            log_event(app, 'service_start_end_error', `${format_seconds(Date.now() - time0)} ${log_words({service: service.name, instance: instance.slot, failures: service.state.failures, reason: error.message})}`);
            if (service.state.failures >= service.policy.start_tries) {
                service.state.gave_up_at = Date.now();
                service.state.last_error = `${error.message} — serviceman stopped trying after ${service.state.failures} starts in a row that failed`;
                log_event(app, 'service_gave_up', {service: service.name, tries: service.state.failures, reason: error.message});
            }
            throw error;
        }
    }
}

async function start_on(app, service, instance, remote, time0)
{
    const upstream = await driver_start(app, remote, service, instance);
    // The pool is made before the probe, because the probe asks through it
    agent_reset(app, service, instance);
    const answered = ((upstream === null) ? null : await wait_http_answer(app, service, instance, upstream, service.policy.start_timeout_ms));
    instance.upstream = upstream;
    instance.phase = 'running';
    instance.started_at = Date.now();
    instance.last_activity_at = Date.now();
    service.state.cold_start_ms = Date.now() - time0;
    service.state.failures = 0;
    service.state.gave_up_at = null;
    log_event(app, 'service_start_end_ok', `${format_seconds(Date.now() - time0)} ${log_words(Object.assign({service: service.name, instance: instance.slot, remote: remote.name}, ready_words(service, upstream), {answered}))}`);
    pool_pump(app, service);
    return instance;
}

// Another machine is only worth trying while one is left that has not said no
function more_to_try(app, service, refused, instance)
{
    return remote_candidates(app, service).some(v => (v.name !== instance.remote) && (refused.includes(v.name) === false));
}

function driver_start(app, remote, service, instance)
{
    if (service.type === 'docker') {
        return docker_start(app, remote, service, instance.slot);
    }
    if (service.type === 'shell') {
        return shell_start_on(app, remote, service, instance);
    }
    throw new Error(`${service.name}: a ${service.type} service is not started by serviceman`);
}

// Where the instance ended up, for the line that says it is ready. A program that serves no
// port has no address at all: it only runs.
function ready_words(service, upstream)
{
    if (upstream === null) {
        return {};
    }
    return {
        upstream: `${upstream.host}:${upstream.port}`,
        inside: service.port,
    };
}

module.exports = instance_start;
