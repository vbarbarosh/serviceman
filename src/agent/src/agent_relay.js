const agent_dir = require('./agent_dir');
const agent_doors_state = require('./agent_doors_state');
const agent_say = require('./agent_say');
const agent_tunnel = require('./agent_tunnel');
const fs = require('fs');
const net = require('net');
const path = require('path');

// Beside the door, for this agent alone: what it hands to serviceman goes in here and comes out
// over the link, byte for byte, exactly as the door carried everything before it routed
const RELAY_NAME = 'relay.sock';

let opened = null;

// The relay's file, opened the first time a door asks for it — the machine's own door
// (agent_http_serve) or a board's on its loopback (agent_local_serve) — and kept for the life of
// the agent. Only the agent's user may open it.
function agent_relay(group)
{
    if (opened !== null) {
        return opened;
    }
    const file = path.join(agent_dir(), RELAY_NAME);
    const relaying = net.createServer(function (socket) {
        socket.on('error', function () {
            socket.destroy();
        });
        if (agent_doors_state.link === null) {
            socket.destroy();
            return;
        }
        agent_tunnel.open(agent_doors_state.link, socket, {http: {}});
    });
    relaying.on('error', function (error) {
        agent_say(group, 'http_socket_error', {socket: file, reason: error.message});
    });
    try {
        fs.unlinkSync(file);
    }
    catch {
        // It was not there, which is the usual case
    }
    relaying.listen(file, function () {
        fs.chmodSync(file, 0o600);
    });
    opened = file;
    return file;
}

module.exports = agent_relay;
