const log_event = require('./log_event');
const program_folder_remove = require('./program_folder_remove');
const program_step = require('./program_step');
const remote_candidates = require('./remote_candidates');
const service_phase = require('./service_phase');
const service_stop = require('./service_stop');

// A service that is gone from the config. A container outlives serviceman and is adopted again,
// so it is left alone; a program is the agent's child on serviceman's behalf, and leaving it
// would leave an orphan nobody will ever adopt. So it stops, its uninstall line runs, and the
// folder made for it goes with it — uninstall means gone.
async function service_uninstall(app, service)
{
    if (service.type !== 'shell') {
        return null;
    }
    const done = [];
    if (service_phase(service) !== 'stopped') {
        await service_stop(app, service, 'the service was removed from the config');
        done.push('stopped');
    }
    const remote = machine_of(app, service);
    if (remote === null) {
        log_event(app, 'program_step_end_error', {service: service.name, step: 'uninstall', reason: 'no machine of its own is online'});
        return done.join(', ');
    }
    const answer = await program_step(app, remote, service, 'uninstall', {SERVICEMAN_REASON: 'removed'});
    if (answer.ran) {
        done.push('its uninstall line ran');
    }
    if (await program_folder_remove(app, remote, service)) {
        done.push('the folder serviceman made for it is gone');
    }
    return done.join(', ');
}

// Where it ran, or would have: the first machine of its own that is online
function machine_of(app, service)
{
    for (const remote of remote_candidates(app, service)) {
        if (remote.state.phase === 'online') {
            return remote;
        }
    }
    return null;
}

module.exports = service_uninstall;
