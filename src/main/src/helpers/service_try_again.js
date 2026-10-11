const log_event = require('./log_event');

// Something changed: a person asked, its machine came back, its definition was edited. Whatever
// it was, the count starts again — this is the only way back from having given up.
function service_try_again(app, service)
{
    if ((service.state.gave_up_at === null) && (service.state.failures === 0)) {
        return false;
    }
    service.state.failures = 0;
    service.state.gave_up_at = null;
    log_event(app, 'service_try_again', {service: service.name});
    return true;
}

module.exports = service_try_again;
