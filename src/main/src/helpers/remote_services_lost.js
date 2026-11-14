const log_event = require('./log_event');
const service_never_started = require('./service_never_started');

// The link is gone, so the containers on that machine are out of reach. Nothing about them
// changed — only what this host can see — so they are marked lost, not stopped: stopped is what
// serviceman says when serviceman stopped it. The last address it answered on is kept, and the
// agent dialling in again is what settles whether it is still there.
function remote_services_lost(app, remote)
{
    for (const service of app.services) {
        // Not ours to lose: it runs over there whatever the link does, and a visitor is told
        // it does not answer until the link is back; a folder of files is served here
        if (service_never_started(service)) {
            continue;
        }
        let held = false;
        for (const instance of service.state.instances) {
            if ((instance.phase === 'stopped') || (instance.remote !== remote.name)) {
                continue;
            }
            held = true;
            instance.phase = 'lost';
        }
        if (held) {
            log_event(app, 'remote_service_lost', {service: service.name, remote: remote.name});
        }
    }
}

module.exports = remote_services_lost;
