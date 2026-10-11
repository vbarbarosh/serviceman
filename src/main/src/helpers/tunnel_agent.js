const http = require('http');
const tunnel_open = require('./tunnel_open');

const AGENT_OPTIONS = {keepAlive: true, maxSockets: 128};

// An http.Agent whose sockets are streams inside the link, so a service on another machine
// is reached the same way as one on this host
function tunnel_agent(remote)
{
    const out = new http.Agent(AGENT_OPTIONS);
    out.createConnection = function (options) {
        return tunnel_open(remote, {host: (options.host || options.hostname), port: options.port});
    };
    return out;
}

module.exports = tunnel_agent;
