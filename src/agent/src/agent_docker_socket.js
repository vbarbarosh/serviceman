const agent_shell = require('./agent_shell');

// Where this machine's docker engine answers. DOCKER_HOST when it names a socket; otherwise
// what the docker command itself uses — a rootless docker or a context lives elsewhere — and
// the usual place when the command does not say.
async function agent_docker_socket(options)
{
    const host = process.env.DOCKER_HOST || '';
    if (host.startsWith('unix://')) {
        return host.slice('unix://'.length);
    }
    const answer = await agent_shell([options.docker, 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
    if (answer.ok && answer.stdout.startsWith('unix://')) {
        return answer.stdout.slice('unix://'.length);
    }
    return '/var/run/docker.sock';
}

module.exports = agent_docker_socket;
