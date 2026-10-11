// The one word for the whole pool: what the pages and the reaper see
function service_phase(service)
{
    const phases = [];
    for (const instance of service.state.instances) {
        phases.push(instance.phase);
    }
    if (phases.includes('running')) {
        return 'running';
    }
    if (phases.includes('starting')) {
        return 'starting';
    }
    if (phases.includes('stopping')) {
        return 'stopping';
    }
    if (phases.includes('failed')) {
        return 'failed';
    }
    // Out of reach is not stopped, and saying stopped would be a lie about somebody else's machine
    if (phases.includes('lost')) {
        return 'lost';
    }
    return 'stopped';
}

module.exports = service_phase;
