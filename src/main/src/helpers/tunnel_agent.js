const http = require('http');
const tunnel_open = require('./tunnel_open');

const AGENT_OPTIONS = {keepAlive: true, maxSockets: 128};

// An http.Agent whose sockets are streams inside the link, so a service on another machine
// is reached the same way as one on this host. With a socket file, every stream goes into that
// file on the machine, whatever host and port the request names.
function tunnel_agent(remote, socket)
{
    const out = new http.Agent(AGENT_OPTIONS);
    out.createConnection = function (options) {
        return tunnel_open(remote, ((socket === undefined) || (socket === null)) ? {host: options.host || options.hostname, port: options.port} : {path: socket});
    };
    return out;
}

module.exports = tunnel_agent;
