// A service takes back what was counted for it. A copy that was up keeps the time it came up
// aside, for the probe that finds it still running to use instead of now.
function counters_apply(service, saved)
{
    if ((saved === undefined) || (saved === null)) {
        return;
    }
    if (Number.isFinite(saved.requests)) {
        service.state.requests = saved.requests;
    }
    if (Number.isFinite(saved.cold_start_ms)) {
        service.state.cold_start_ms = saved.cold_start_ms;
    }
    const instances = (((saved.instances === undefined) || (saved.instances === null)) ? {} : saved.instances);
    for (const instance of service.state.instances) {
        const found = instances[instance.slot];
        if ((found === undefined) || (found === null)) {
            continue;
        }
        if (Number.isFinite(found.requests)) {
            instance.requests = found.requests;
        }
        if (Number.isFinite(found.started_at)) {
            instance.started_before = found.started_at;
        }
    }
}

module.exports = counters_apply;
