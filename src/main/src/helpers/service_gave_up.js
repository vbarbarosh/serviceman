// A service serviceman has stopped trying to start. It failed as many times in a row as its
// policy allows, and nothing about it has changed since — so the next request is answered from
// what is already known instead of repeating the work and the failure.
function service_gave_up(service)
{
    return service.state.gave_up_at !== null;
}

module.exports = service_gave_up;
