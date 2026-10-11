const agent_reset = require('./agent_reset');
const docker_stop = require('./docker_stop');
const format_seconds = require('../../../helpers/format_seconds');
const instance_stopped = require('./instance_stopped');
const log_event = require('./log_event');
const log_group = require('./log_group');
const log_words = require('../../../helpers/log_words');
const remote_from_instance = require('./remote_from_instance');
const shell_stop_on = require('./shell_stop_on');

// Stops one instance; two callers asking at once share one stop
function instance_stop(app, service, instance, reason)
{
    if (instance.stop_promise !== null) {
        return instance.stop_promise;
    }
    const out = log_group(() => stop_now(app, service, instance, reason));
    instance.stop_promise = out;
    function clear() {
        instance.stop_promise = null;
    }
    out.then(clear, clear);
    return out;
}

async function stop_now(app, service, instance, reason)
{
    const time0 = Date.now();
    instance.phase = 'stopping';
    instance.asked_to_stop = true;
    clearTimeout(instance.restart_timer);
    log_event(app, 'service_stop_begin', {service: service.name, instance: instance.slot, reason});
    try {
        if (service.type === 'docker') {
            await docker_stop(app, remote_from_instance(app, service, instance), service, instance.slot);
        }
        if (service.type === 'shell') {
            await shell_stop_on(app, remote_from_instance(app, service, instance), service, instance, reason);
        }
        agent_reset(app, service, instance);
        instance_stopped(instance);
        log_event(app, 'service_stop_end_ok', `${format_seconds(Date.now() - time0)} ${log_words({service: service.name, instance: instance.slot})}`);
    }
    catch (error) {
        instance.phase = 'failed';
        instance.last_error = error.message;
        service.state.last_error = error.message;
        log_event(app, 'service_stop_end_error', `${format_seconds(Date.now() - time0)} ${log_words({service: service.name, instance: instance.slot, reason: error.message})}`);
        throw error;
    }
}

module.exports = instance_stop;
