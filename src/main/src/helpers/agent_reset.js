const http = require('http');
const tunnel_agent = require('./tunnel_agent');

const AGENT_OPTIONS = {keepAlive: true, maxSockets: 128};

// A stopped service leaves dead sockets behind; the next start gets a clean pool. A service is
// reached through the link its remote's agent dialled in on, never over the network; an
// instance reserved nowhere gets a plain pool that nothing will dial through.
function agent_reset(app, service, instance)
{
    if (instance.agent !== null) {
        instance.agent.destroy();
    }
    const remote = ((instance.remote === null) ? undefined : app.remote_by_name[instance.remote]);
    instance.agent = ((remote === undefined) ? new http.Agent(AGENT_OPTIONS) : tunnel_agent(remote));
    return instance.agent;
}

module.exports = agent_reset;
