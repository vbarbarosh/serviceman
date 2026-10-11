// Requests inside the whole pool right now
function service_inflight(service)
{
    let out = 0;
    for (const instance of service.state.instances) {
        out += instance.inflight;
    }
    return out;
}

module.exports = service_inflight;
