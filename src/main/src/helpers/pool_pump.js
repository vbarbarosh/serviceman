const pool_capacity = require('./pool_capacity');

// Freed or fresh capacity goes to the requests that wait in line
function pool_pump(app, service)
{
    const queue = service.state.queue;
    while (queue.length > 0) {
        const instance = pool_capacity(service);
        if (instance === null) {
            return;
        }
        const waiter = queue.shift();
        clearTimeout(waiter.deadline_timer);
        clearTimeout(waiter.warmup_timer);
        instance.inflight++;
        instance.requests++;
        instance.last_activity_at = Date.now();
        waiter.resolve(instance);
    }
}

module.exports = pool_pump;
