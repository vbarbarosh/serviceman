// The running instance with the most room, or null when every one is full
function pool_capacity(service)
{
    const concurrency = service.policy.concurrency;
    let out = null;
    for (const instance of service.state.instances) {
        if (instance.phase !== 'running') {
            continue;
        }
        if ((concurrency !== null) && (instance.inflight >= concurrency)) {
            continue;
        }
        if ((out === null) || (instance.inflight < out.inflight)) {
            out = instance;
        }
    }
    return out;
}

module.exports = pool_capacity;
