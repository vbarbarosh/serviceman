const format_duration_ms = require('../../../helpers/format_duration_ms');
const instance_stop = require('./instance_stop');
const pool_autoscale = require('./pool_autoscale');
const service_inflight = require('./service_inflight');
const service_stop = require('./service_stop');

// The other half of the policy: the pool follows the work, extra instances shrink to the floor,
// quiet services go to sleep
function reap_idle(app)
{
    const now = Date.now();
    for (const service of app.services) {
        if (service.type === 'external') {
            continue;
        }
        pool_autoscale(app, service, now);
        shrink_pool(app, service, now);
        sleep_service(app, service, now);
    }
}

function shrink_pool(app, service, now)
{
    const floor = Math.max(1, service.policy.instances.min);
    let awake = 0;
    for (const instance of service.state.instances) {
        if ((instance.phase === 'running') || (instance.phase === 'starting')) {
            awake++;
        }
    }
    for (const instance of service.state.instances) {
        if (awake <= floor) {
            return;
        }
        if ((instance.phase !== 'running') || (instance.inflight > 0)) {
            continue;
        }
        const idle_ms = now - ((instance.last_activity_at === null) ? now : instance.last_activity_at);
        if (idle_ms < service.policy.scale_down_after_ms) {
            continue;
        }
        awake--;
        const promise = instance_stop(app, service, instance, `idle instance, ${format_duration_ms(idle_ms)} without work`);
        promise.catch(function (error) {
            // instance_stop wrote why it failed; this catch only keeps the rejection quiet
        });
    }
}

function sleep_service(app, service, now)
{
    if (service.policy.start === 'always') {
        return;
    }
    if (service.policy.stop_after_idle_ms === null) {
        return;
    }
    if ((service_inflight(service) > 0) || (service.state.queue.length > 0)) {
        return;
    }
    let idle_ms = null;
    for (const instance of service.state.instances) {
        if (instance.phase !== 'running') {
            continue;
        }
        const since = (instance.last_activity_at === null) ? now : instance.last_activity_at;
        if ((idle_ms === null) || (now - since < idle_ms)) {
            idle_ms = now - since;
        }
    }
    if ((idle_ms === null) || (idle_ms < service.policy.stop_after_idle_ms)) {
        return;
    }
    const promise = service_stop(app, service, `idle for ${format_duration_ms(idle_ms)}`);
    promise.catch(function (error) {
        // service_stop wrote why it failed; this catch only keeps the rejection quiet
    });
}

module.exports = reap_idle;
