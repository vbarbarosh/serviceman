const instance_stop = require('./instance_stop');
const log_event = require('./log_event');
const program_install = require('./program_install');
const remote_from_instance = require('./remote_from_instance');
const remote_reserve = require('./remote_reserve');
const service_ensure_running = require('./service_ensure_running');
const service_phase = require('./service_phase');
const service_try_again = require('./service_try_again');

// The program moved on: fetch it again and start what came back.
//
// Its update line runs when the config has one — that is what an update line is for — and
// without one the install line runs again in an empty folder, which for a `git clone` is the
// same thing said differently. What it keeps is untouched: storage is folders of its own, and
// the folder it runs in is named after the service, so both are the same after as before.
async function service_reinstall(app, service)
{
    if ((service.type !== 'shell') || (service.lifecycle.install === null)) {
        throw new Error(`${service.name}: there is nothing to fetch — it has no install line`);
    }
    const instance = service.state.instances[0];
    const running = (service_phase(service) === 'running');
    log_event(app, 'service_update_begin', {service: service.name, was: service_phase(service)});
    // A fetch takes minutes and leaves the service stopped the whole time, which is a picture
    // of nothing happening. This is what the page shows instead, and the story starts here.
    service.state.doing = 'fetching the program';
    service.state.said = [];
    try {
        if (running) {
            await instance_stop(app, service, instance, 'it is being fetched again');
        }
        const remote = ((instance.remote === null) ? remote_reserve(app, service, instance, []) : remote_from_instance(app, service, instance));
        await program_install(app, remote, service, true);
    }
    catch (error) {
        service.state.last_error = error.message;
        log_event(app, 'service_update_end_error', {service: service.name, reason: error.message});
        throw error;
    }
    finally {
        service.state.doing = null;
    }
    log_event(app, 'service_update_end_ok', {service: service.name});
    // Whatever it failed at before is history: this is a different program now
    service_try_again(app, service);
    if (running) {
        await service_ensure_running(app, service);
    }
}

module.exports = service_reinstall;
