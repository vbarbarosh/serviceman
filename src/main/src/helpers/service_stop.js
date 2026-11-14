const instance_stop = require('./instance_stop');
const log_event = require('./log_event');
const service_never_started = require('./service_never_started');

// Stops the whole pool; two callers asking at once share one stop
function service_stop(app, service, reason)
{
    const state = service.state;
    if (service_never_started(service)) {
        return Promise.resolve();
    }
    if (state.stop_promise !== null) {
        return state.stop_promise;
    }
    const out = stop_now(app, service, reason);
    state.stop_promise = out;
    function clear() {
        state.stop_promise = null;
    }
    out.then(clear, clear);
    return out;
}

async function stop_now(app, service, reason)
{
    const stops = [];
    for (const instance of service.state.instances) {
        if (instance.phase === 'stopped') {
            restart_call_off(app, service, instance, reason);
            continue;
        }
        stops.push(instance_stop(app, service, instance, reason));
    }
    await Promise.all(stops);
    service.state.stopped_at = Date.now();
}

// A program that ended by itself is stopped and still meant to be up: the timer that starts it
// again is all there is of it, and a stop that left the timer would be undone a second later.
// Its count of restarts stays, so one started again at once waits as long as its next restart
// would have.
function restart_call_off(app, service, instance, reason)
{
    if (instance.restart_timer === null) {
        return;
    }
    clearTimeout(instance.restart_timer);
    instance.restart_timer = null;
    log_event(app, 'program_restart_cancel', {service: service.name, instance: instance.slot, restart: instance.restarts, reason});
}

module.exports = service_stop;
