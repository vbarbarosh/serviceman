const docker_stop = require('./docker_stop');
const program_step = require('./program_step');
const remote_call = require('./remote_call');

// Stops the program: the stop line first, if the config gave one, then the program itself,
// which is the agent's child to end
async function shell_stop_on(app, remote, service, instance, reason)
{
    await program_step(app, remote, service, 'stop', {SERVICEMAN_REASON: String((reason === undefined) ? '' : reason)});
    if (service.image !== null) {
        await docker_stop(app, remote, service, instance.slot);
        return;
    }
    instance.pid = null;
    await remote_call(app, remote, 'program_stop', {name: service.name, slot: instance.slot, grace_ms: service.policy.stop_timeout_ms});
}

module.exports = shell_stop_on;
