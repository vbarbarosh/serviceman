const http = require('http');
const net = require('net');
const os = require('os');
const tunnel_agent = require('./tunnel_agent');

const AGENT_OPTIONS = {keepAlive: true, maxSockets: 128};

// A stopped service leaves dead sockets behind; the next start gets a clean pool. A service is
// reached through the link its remote's agent dialled in on, never over the network; an
// instance reserved nowhere gets a plain pool that nothing will dial through. An app on a
// socket file is reached in that file, on its machine or on this host.
function agent_reset(app, service, instance)
{
    if (instance.agent !== null) {
        instance.agent.destroy();
    }
    const remote = (instance.remote === null) ? undefined : app.remote_by_name[instance.remote];
    const socket = ((instance.upstream === null) || (instance.upstream === undefined) || (instance.upstream.socket === undefined)) ? null : instance.upstream.socket;
    if (remote !== undefined) {
        instance.agent = tunnel_agent(remote, socket);
        return instance.agent;
    }
    instance.agent = new http.Agent(AGENT_OPTIONS);
    if (socket !== null) {
        const file = socket.startsWith('~/') ? `${os.homedir()}${socket.slice(1)}` : socket;
        instance.agent.createConnection = function () {
            return net.connect({path: file});
        };
    }
    return instance.agent;
}

module.exports = agent_reset;
