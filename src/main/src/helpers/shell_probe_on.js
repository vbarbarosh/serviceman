const remote_call = require('./remote_call');

// Is the program already running on that machine? The agent knows, a restarted one too: it
// wrote down what it started, and only a program that is gone is started again. false when it
// is not; when it is, where it answers, or null for a program with no port, which runs all the
// same.
async function shell_probe_on(app, remote, service, instance)
{
    const answer = await remote_call(app, remote, 'program_probe', {name: service.name, slot: instance.slot});
    if (answer.running === false) {
        return false;
    }
    instance.pid = answer.pid;
    return (service.port === null) ? null : {host: '127.0.0.1', port: service.port};
}

module.exports = shell_probe_on;
