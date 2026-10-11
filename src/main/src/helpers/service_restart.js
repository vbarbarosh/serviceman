const log_event = require('./log_event');
const service_ensure_running = require('./service_ensure_running');
const service_phase = require('./service_phase');
const service_stop = require('./service_stop');
const service_try_again = require('./service_try_again');

// Stop it and start it again as one thing.
//
// Done as two asks from the outside it is a race: the stop has not finished when the start
// arrives, so the start meets a container that is still going and does nothing. One ask waits
// for the stop it made itself.
//
// A service that is not running is simply started, because that is what someone pressing this
// on a stopped service means.
async function service_restart(app, service)
{
    log_event(app, 'service_restart_begin', {service: service.name, was: service_phase(service)});
    try {
        await service_stop(app, service, 'restarted from the control page');
        // Someone asking is a change: whatever it gave up on before, it tries again now
        service_try_again(app, service);
        await service_ensure_running(app, service);
    }
    catch (error) {
        service.state.last_error = error.message;
        log_event(app, 'service_restart_end_error', {service: service.name, reason: error.message});
        throw error;
    }
    log_event(app, 'service_restart_end_ok', {service: service.name});
}

module.exports = service_restart;
