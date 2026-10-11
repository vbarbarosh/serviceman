const remote_candidates = require('./remote_candidates');

// A service on a remote can do nothing until that remote's agent is dialled in
function service_waits_for_remote(app, service)
{
    return remote_candidates(app, service).some(v => v.state.phase === 'online') === false;
}

module.exports = service_waits_for_remote;
