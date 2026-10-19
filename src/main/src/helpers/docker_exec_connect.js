const tunnel_open = require('./tunnel_open');

// How to reach the docker that runs this service's containers: a stream through the link to
// the socket on the remote's machine. Answers with the way to open it, because the
// REMOTE_API_KEEP needs a fresh one for every call.
function docker_exec_connect(app, remote)
{
    const there = (remote.state.resources === null) ? null : remote.state.resources.docker_socket;
    if ((there === null) || (there === undefined)) {
        throw new Error(`docker on remote ${remote.name} has no socket its agent can reach, so no shell can be opened`);
    }
    return function () {
        return tunnel_open(remote, {path: there});
    };
}

module.exports = docker_exec_connect;
