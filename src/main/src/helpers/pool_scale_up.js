const instance_start = require('./instance_start');
const log_event = require('./log_event');

// Starts one more instance when the pool is allowed to grow; answers whether it did
function pool_scale_up(app, service, reason)
{
    let idle = null;
    let busy = 0;
    for (const instance of service.state.instances) {
        if ((instance.phase === 'running') || (instance.phase === 'starting') || (instance.start_promise !== null)) {
            busy++;
            continue;
        }
        if (idle === null) {
            idle = instance;
        }
    }
    if ((idle === null) || (busy >= service.policy.instances.max)) {
        return false;
    }
    log_event(app, 'service_scale_up', {service: service.name, instance: idle.slot, of: service.policy.instances.max, reason});
    const promise = instance_start(app, service, idle);
    promise.catch(function (error) {
        // instance_start wrote why it failed; this catch only keeps the rejection quiet
    });
    return true;
}

module.exports = pool_scale_up;
