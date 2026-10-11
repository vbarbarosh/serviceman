// What of a service is counted rather than configured, as the file keeps it: requests served,
// how long the last start took, and — for a copy that is up — when it came up
function counters_from_service(service)
{
    const instances = {};
    for (const instance of service.state.instances) {
        instances[instance.slot] = {
            requests: instance.requests,
            started_at: (((instance.phase === 'running') || (instance.phase === 'lost')) ? instance.started_at : null),
        };
    }
    return {
        requests: service.state.requests,
        cold_start_ms: service.state.cold_start_ms,
        instances,
    };
}

module.exports = counters_from_service;
