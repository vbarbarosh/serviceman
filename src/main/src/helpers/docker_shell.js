const remote_call = require('./remote_call');

const DOCKER_TIMEOUT_MS = 600000;

// One docker command, run where the service lives: on the machine of its remote, by the agent.
// The answer has the shape of a shell command's — ok, code, stdout, stderr — so the drivers
// above read it as if it ran here.
//
// Naming a service makes the command loud: every line it prints is said as it prints it, and
// is kept for the page somebody is waiting on. A `docker pull` of a fat image is minutes of
// work, and minutes of silence is what makes a start look like a hang.
//
// Asking for a terminal makes it say more than it would through a pipe — see shell_pty_argv.
function docker_shell(app, remote, argv, service, pty)
{
    return remote_call(app, remote, 'docker', {argv, service, pty}, DOCKER_TIMEOUT_MS);
}

module.exports = docker_shell;
