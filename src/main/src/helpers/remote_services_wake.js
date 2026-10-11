const remote_candidates = require('./remote_candidates');
const service_ensure_running = require('./service_ensure_running');
const service_phase = require('./service_phase');
const service_probe = require('./service_probe');
const service_try_again = require('./service_try_again');

// A remote that comes online brings its services back: a container already running there is
// adopted, and a service that must always run is started
async function remote_services_wake(app, remote)
{
    for (const service of app.services) {
        // By name or by a tag it carries: a machine that arrives brings back everything it
        // may run, including services that named no machine of their own
        if (remote_candidates(app, service).includes(remote) === false) {
            continue;
        }
        // Its machine is back, which is a change: whatever serviceman gave up on is tried again
        service_try_again(app, service);
        await service_probe(app, service);
        if ((service.policy.start !== 'always') || (service_phase(service) === 'running')) {
            continue;
        }
        const promise = service_ensure_running(app, service);
        promise.catch(function () {
            // instance_start wrote why it failed; this catch only keeps the rejection quiet
        });
    }
}

module.exports = remote_services_wake;
