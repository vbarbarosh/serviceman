const program_docker_start = require('./program_docker_start');
const program_install = require('./program_install');
const remote_call = require('./remote_call');
const secrets_deliver = require('./secrets_deliver');
const secrets_env = require('../../../helpers/secrets_env');

// A program on the machine that will carry it: put its folder in place if there is an install
// line, then run it. The agent holds the child, and what comes back is the address on that
// machine — which is where its tunnel dials.
async function shell_start_on(app, remote, service, instance)
{
    await program_install(app, remote, service);
    const secrets = await secrets_deliver(app, remote, service);
    // With an image the program is a container of ours from here on, wherever it runs
    if (service.image !== null) {
        return await program_docker_start(app, remote, service, instance, secrets);
    }
    const answer = await remote_call(app, remote, 'program_start', {
        name: service.name,
        slot: instance.slot,
        cwd: service.cwd,
        argv: shell_argv(service),
        env: Object.assign({}, secrets_env(secrets), service.env),
    });
    instance.pid = answer.pid;
    instance.asked_to_stop = false;
    return ((service.port === null) ? null : {host: '127.0.0.1', port: service.port});
}

function shell_argv(service)
{
    return ((Array.isArray(service.argv) && (service.argv.length > 0)) ? service.argv : ['/bin/sh', '-c', service.command]);
}

module.exports = shell_start_on;
