const agent_dir = require('./agent_dir');
const agent_door_answer = require('./agent_door_answer');
const agent_doors_state = require('./agent_doors_state');
const agent_say = require('./agent_say');
const agent_tunnel = require('./agent_tunnel');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const SOCKET_NAME = 'http.sock';
// Beside the door, for this agent alone: what it hands to serviceman goes in here and comes out
// over the link, byte for byte, exactly as the door carried everything before it routed
const RELAY_NAME = 'relay.sock';

// The way in. Whatever connects to this file — the web server on this machine, and nothing else
// can — is answered here: each request by this machine's door table, straight to the wall and
// the service, with serviceman or without it; and what the table does not route, by serviceman
// over the link.
//
// There is no door unless somebody asked for one: `--http-socket-mode 0660` is the whole of
// the asking, and a machine with no mode written for it carries nothing in. Bringing the
// public onto a machine is a thing it is told to do, never something it does because it can.
//
// It is a file rather than a port on purpose: the mode is also the whole of who may knock. At
// 0600 that is nobody but the user this agent runs as; a group and 0660 is what lets a web
// server in front of it.
//
// The door stands for the life of the agent, not of a link: what the table routes goes on being
// answered while serviceman is away, and only what serviceman itself would answer gets a 502.
function agent_http_serve(options, group)
{
    const file = path.join(agent_dir(), SOCKET_NAME);
    const mode = mode_of(options);
    if (mode === null) {
        const said = (options === undefined) ? '' : options.http_socket_mode;
        if ((said !== undefined) && (said !== '')) {
            agent_say(group, 'http_socket_error', {mode: said, reason: 'that is not a file mode, so no door was opened'});
        }
        return null;
    }
    const relay = path.join(agent_dir(), RELAY_NAME);
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
    listen_file(relaying, relay, 0o600, group, null);
    const out = http.createServer(function (req, res) {
        agent_door_answer(options, relay, req, res);
    });
    out.on('upgrade', function (req, socket, head) {
        socket.on('error', function () {
            socket.destroy();
        });
        agent_door_answer.upgrade(options, relay, req, socket, head);
    });
    listen_file(out, file, mode, group, function () {
        agent_say(group, 'http_socket_begin', {socket: file, mode: mode.toString(8).padStart(4, '0')});
    });
    return out;
}

// A socket file outlives the process that made it; one nobody answers on is this one's to take
function listen_file(server, file, mode, group, done)
{
    server.on('error', function (error) {
        agent_say(group, 'http_socket_error', {socket: file, reason: error.message});
    });
    try {
        fs.unlinkSync(file);
    }
    catch {
        // It was not there, which is the usual case
    }
    server.listen(file, function () {
        fs.chmodSync(file, mode);
        if (done !== null) {
            done();
        }
    });
}

// The door closed, and the file with it — at the end of the agent's life
agent_http_serve.close = function (server) {
    if (server === null) {
        return;
    }
    server.close();
    try {
        fs.unlinkSync(path.join(agent_dir(), SOCKET_NAME));
    }
    catch {
        // Somebody else's to worry about: it is already gone
    }
};

// What this machine's door is right now, for the host to show: where it is and who may knock,
// read from the file rather than remembered — a mode changed by hand is the truth about it.
agent_http_serve.door = function () {
    const file = path.join(agent_dir(), SOCKET_NAME);
    try {
        const stat = fs.statSync(file);
        return {path: file, mode: (stat.mode & 0o777).toString(8).padStart(4, '0')};
    }
    catch {
        // No door: an agent that was never asked for one
        return null;
    }
};

// The mode that was asked for, or null for a machine that was asked for no door at all
function mode_of(options)
{
    const said = (options === undefined) ? '' : options.http_socket_mode;
    if ((said === undefined) || (said === '')) {
        return null;
    }
    const mode = parseInt(said, 8);
    return Number.isNaN(mode) ? null : mode;
}

module.exports = agent_http_serve;
