const plural = require('@vbarbarosh/node-helpers/src/plural');
const pool_capacity = require('./pool_capacity');
const pool_pump = require('./pool_pump');
const pool_scale_up = require('./pool_scale_up');

// One request asks for an instance: free capacity answers now, the rest wait in line
function pool_acquire(app, service, deadline)
{
    const state = service.state;
    const instance = pool_capacity(service);
    if ((instance !== null) && (state.queue.length === 0)) {
        instance.inflight++;
        instance.requests++;
        instance.last_activity_at = Date.now();
        return Promise.resolve(instance);
    }
    return new Promise(function (resolve, reject) {
        const waiter = {resolve, reject, deadline_timer: null, warmup_timer: null};
        state.queue.push(waiter);
        if (deadline !== null) {
            waiter.deadline_timer = setTimeout(function () {
                waiter_drop(state, waiter);
                const error = new Error(`the request waited ${Math.round(service.policy.request_timeout_ms/1000)}s for a free instance`);
                error.status = 504;
                reject(error);
            }, Math.max(0, deadline - Date.now()));
        }
        if (state.queue.length >= service.policy.warmup.queue) {
            pool_scale_up(app, service, plural(state.queue.length, '# request waits', '# requests wait'));
        }
        else {
            waiter.warmup_timer = setTimeout(function () {
                if (state.queue.includes(waiter)) {
                    pool_scale_up(app, service, 'a request waits too long');
                }
            }, service.policy.warmup.wait_ms);
        }
        pool_pump(app, service);
    });
}

function waiter_drop(state, waiter)
{
    const at = state.queue.indexOf(waiter);
    if (at >= 0) {
        state.queue.splice(at, 1);
    }
    clearTimeout(waiter.warmup_timer);
}

module.exports = pool_acquire;
