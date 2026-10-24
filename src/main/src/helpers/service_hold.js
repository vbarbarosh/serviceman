const instance_stop = require('./instance_stop');

// Takes every instance of a service out of the run while `work` is done to its folder, and puts
// none of them back: whether it starts again is the caller's to say. Every instance is stopped
// whatever its phase, no restart waits, and a start asked meanwhile, by a request, a restart
// timer or a person, waits for the work to end instead of running a program in a folder that is
// half of two versions.
async function service_hold(app, service, reason, work)
{
    let release = null;
    service.state.hold_promise = new Promise(function (resolve) {
        release = resolve;
    });
    try {
        await instances_out(app, service, reason);
        return await work();
    }
    finally {
        service.state.hold_promise = null;
        release();
    }
}

// A start on the way is asked to stop, and waited for: it may have started a program after
// the stop came, which the next round stops. A start that has not begun waits for the hold.
async function instances_out(app, service, reason)
{
    for (;;) {
        const waits = [];
        for (const instance of service.state.instances) {
            clearTimeout(instance.restart_timer);
            instance.restart_timer = null;
            if (instance.phase !== 'stopped') {
                waits.push(instance_stop(app, service, instance, reason));
            }
            if (instance.start_under_way) {
                waits.push(instance.start_promise.catch(function () {}));
            }
        }
        if (waits.length === 0) {
            return;
        }
        await Promise.all(waits);
    }
}

module.exports = service_hold;
