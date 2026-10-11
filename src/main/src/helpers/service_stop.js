const instance_stop = require('./instance_stop');

// Stops the whole pool; two callers asking at once share one stop
function service_stop(app, service, reason)
{
    const state = service.state;
    if (service.type === 'external') {
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
            continue;
        }
        stops.push(instance_stop(app, service, instance, reason));
    }
    await Promise.all(stops);
    service.state.stopped_at = Date.now();
}

module.exports = service_stop;
