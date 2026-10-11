// The socket the REMOTE_API_KEEP is asked through; a docker that lives on another machine has none here
function docker_socket_path(config, env)
{
    if (config.docker_socket) {
        return config.docker_socket;
    }
    const host = env.DOCKER_HOST || '';
    if (host === '') {
        return '/var/run/docker.sock';
    }
    if (host.startsWith('unix://')) {
        return host.slice('unix://'.length);
    }
    if (host.startsWith('/')) {
        return host;
    }
    return null;
}

module.exports = docker_socket_path;
