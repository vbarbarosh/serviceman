const instance_start = require('./instance_start');
const pool_scale_up = require('./pool_scale_up');
const service_phase = require('./service_phase');

// The single door of a cold service: the first instance blocks, the rest of min warm behind it
function service_ensure_running(app, service)
{
    if (service_phase(service) === 'running') {
        warm_to_min(app, service);
        return Promise.resolve(service);
    }
    for (const instance of service.state.instances) {
        if (instance.start_promise !== null) {
            return instance.start_promise;
        }
    }
    const first = service.state.instances[0];
    const out = instance_start(app, service, first);
    out.then(function () {
        warm_to_min(app, service);
    }, function () {});
    return out;
}

function warm_to_min(app, service)
{
    for (;;) {
        let awake = 0;
        for (const instance of service.state.instances) {
            if ((instance.phase === 'running') || (instance.phase === 'starting') || (instance.start_promise !== null)) {
                awake++;
            }
        }
        if (awake >= service.policy.instances.min) {
            return;
        }
        if (pool_scale_up(app, service, `the policy keeps ${service.policy.instances.min} instances`) === false) {
            return;
        }
    }
}

module.exports = service_ensure_running;
