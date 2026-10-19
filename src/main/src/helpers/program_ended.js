const format_seconds = require('../../../helpers/format_seconds');
const instance_stopped = require('./instance_stopped');
const log_event = require('./log_event');

const FIRST_RESTART_MS = 1000;
const LONGEST_RESTART_MS = 30000;
const SETTLED_MS = 30000;

// A program stopped by itself on its machine, and the agent said so. The instance is marked for
// what it is now, and the restart policy decides what follows — a program that was asked to
// stop is simply stopped, and nothing follows.
function program_ended(app, remote, message)
{
    const service = app.service_by_name[String(message.service)];
    if ((service === undefined) || (service.type !== 'shell')) {
        return;
    }
    const instance = service.state.instances.find(v => (v.slot === message.slot) && (v.remote === remote.name));
    if ((instance === undefined) || (instance.phase === 'stopped')) {
        return;
    }
    const code = (message.code === undefined) ? null : message.code;
    const signal = (message.signal === undefined) ? null : message.signal;
    instance.pid = null;
    if ((code === 0) || (signal !== null)) {
        instance_stopped(instance);
    }
    else {
        instance.phase = 'failed';
        instance.upstream = null;
        instance.stopped_at = Date.now();
    }
    if (instance.asked_to_stop || (restart_wanted(service, code) === false)) {
        return;
    }
    if (Date.now() - instance.started_at > SETTLED_MS) {
        instance.restarts = 0;
    }
    const wait_ms = Math.min(FIRST_RESTART_MS*Math.pow(2, instance.restarts), LONGEST_RESTART_MS);
    instance.restarts++;
    log_event(app, 'program_restart_wait', {service: service.name, in: format_seconds(wait_ms), restart: instance.restarts});
    instance.restart_timer = setTimeout(function () {
        restart_now(app, service, instance);
    }, wait_ms);
    instance.restart_timer.unref();
}

function restart_wanted(service, code)
{
    if (service.policy.restart === 'always') {
        return true;
    }
    return (service.policy.restart === 'on_failure') && (code !== 0);
}

function restart_now(app, service, instance)
{
    // instance_start requires the drivers, and one of them asks for this file
    const instance_start = require('./instance_start');
    if (service.state.stop_promise !== null) {
        return;
    }
    const promise = instance_start(app, service, instance);
    promise.catch(function () {
        // instance_start wrote why it failed; this catch only keeps the rejection quiet
    });
}

module.exports = program_ended;
