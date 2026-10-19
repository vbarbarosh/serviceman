const format_seconds = require('../../../helpers/format_seconds');
const instance_stop = require('./instance_stop');
const log_event = require('./log_event');
const pool_scale_up = require('./pool_scale_up');
const service_inflight = require('./service_inflight');

// A cold start of this many seconds moves the threshold down by this much, so a service that
// takes a long time to answer starts its next copy earlier than one that is up in a blink
const COLD_START_SHARE = 0.02;

// The pool follows the work, on the clock the reaper already runs on.
//
// `busy` is the share of the pool that is working: requests in flight over what the running
// copies can take at once. It grows when the pool has been busy for `up_for`, and shrinks when
// it has been quiet for `down_for` — two different numbers, so it cannot flap on one. It grows
// by as many copies as the work asks for and shrinks by one at a time, because a copy too many
// costs memory and a copy too few costs a visitor their page.
function pool_autoscale(app, service, now)
{
    const policy = service.policy.autoscale;
    const state = service.state;
    if ((policy === null) || (service.policy.concurrency === null)) {
        return;
    }
    const running = state.instances.filter(v => v.phase === 'running');
    if (running.length === 0) {
        state.busy_up_since = null;
        state.busy_down_since = null;
        return;
    }
    const room = running.length*service.policy.concurrency;
    const busy = (service_inflight(service) + state.queue.length)/room;
    const up_at = busy_up_at(service, policy);
    state.busy_up_since = (busy >= up_at) ? ((state.busy_up_since === null) ? now : state.busy_up_since) : null;
    state.busy_down_since = (busy <= policy.busy_down) ? ((state.busy_down_since === null) ? now : state.busy_down_since) : null;
    if ((state.scaled_at !== null) && (now - state.scaled_at < policy.cool_down_ms)) {
        return;
    }
    if ((state.busy_up_since !== null) && (now - state.busy_up_since >= policy.up_for_ms)) {
        grow(app, service, busy, up_at, running.length, now);
        return;
    }
    if ((state.busy_down_since !== null) && (now - state.busy_down_since >= policy.down_for_ms)) {
        shrink(app, service, busy, running, now);
    }
}

// Where the line is drawn today. A copy that took ten seconds to answer must be started before
// the pool is full, or every visitor after it waits through another ten.
function busy_up_at(service, policy)
{
    if (service.state.cold_start_ms === null) {
        return policy.busy_up;
    }
    const early = Math.min(policy.busy_up/2, service.state.cold_start_ms/1000*COLD_START_SHARE);
    return Math.max(policy.busy_down + 0.05, policy.busy_up - early);
}

function grow(app, service, busy, up_at, running, now)
{
    // As many as the work asks for: at this share, the pool needs about this many copies
    const wanted = Math.min(service.policy.instances.max, Math.ceil(running*busy/up_at));
    const reason = `busy ${busy.toFixed(2)} of ${up_at.toFixed(2)} for ${format_seconds(now - service.state.busy_up_since)}`;
    let added = 0;
    while ((running + added < wanted) && pool_scale_up(app, service, reason)) {
        added++;
    }
    if (added === 0) {
        return;
    }
    service.state.scaled_at = now;
    service.state.busy_up_since = null;
}

function shrink(app, service, busy, running, now)
{
    const floor = Math.max(service.policy.instances.min, 1);
    if (running.length <= floor) {
        return;
    }
    // The emptiest copy is the one nobody will miss; one that is still working is left alone
    const idle = running.filter(v => v.inflight === 0).sort((a, b) => a.last_activity_at - b.last_activity_at)[0];
    if (idle === undefined) {
        return;
    }
    log_event(app, 'service_scale_down', {
        service: service.name,
        instance: idle.slot,
        left: running.length - 1,
        reason: `busy ${busy.toFixed(2)} for ${format_seconds(now - service.state.busy_down_since)}`,
    });
    service.state.scaled_at = now;
    service.state.busy_down_since = null;
    const promise = instance_stop(app, service, idle, 'the pool is bigger than the work');
    promise.catch(function (error) {
        // instance_stop wrote why it failed; this catch only keeps the rejection quiet
    });
}

module.exports = pool_autoscale;
