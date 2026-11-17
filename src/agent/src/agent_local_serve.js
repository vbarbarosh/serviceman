const agent_door_answer = require('./agent_door_answer');
const agent_doors_state = require('./agent_doors_state');
const agent_http_error = require('./agent_http_error');
const agent_relay = require('./agent_relay');
const agent_say = require('./agent_say');
const http = require('http');

// Where this machine's boards are answered, on 127.0.0.1 and nowhere else: whoever sits at this
// machine opens a board at its name under .localhost, and each app on it at its own, and nobody
// on the network it is on, its tailnet included, reaches the port at all. Each request is routed
// by the door table, as the machine's own door routes it (agent_door_answer): straight to where
// the app runs, behind its wall, or to serviceman for the board's page and an app it serves
// itself.
//
// The table says the ports, {local: {ports}}, only on a machine a board is published on; a port
// it no longer names is closed, and one another program holds is said in the log and tried
// again at the next table, or the next start.
//
// {port: {server, error}}
const listening = {};

let started = null;

// At the start of the agent, with the table it has on disk
function agent_local_serve(options, group)
{
    started = {options, group};
    agent_local_serve.apply();
}

// The ports of the table now: each named one listened on, each other closed
agent_local_serve.apply = function () {
    if (started === null) {
        return;
    }
    const table = agent_doors_state.table;
    const wanted = ((table === null) || (table.local === undefined) || (Array.isArray(table.local.ports) === false)) ? [] : table.local.ports;
    for (const port of Object.keys(listening)) {
        if ((wanted.includes(Number(port)) === false) || (listening[port].error !== null)) {
            if (listening[port].server !== null) {
                listening[port].server.close();
            }
            if (listening[port].error === null) {
                agent_say(started.group, 'local_close', {at: `127.0.0.1:${port}`});
            }
            delete listening[port];
        }
    }
    for (const port of wanted) {
        if (listening[port] === undefined) {
            listening[port] = listen(port);
        }
    }
};

// What the boards' ports are now, for the host to show: {port: error}, error null for one that
// listens
agent_local_serve.said = function () {
    const out = {};
    for (const port of Object.keys(listening)) {
        out[port] = listening[port].error;
    }
    return out;
};

function listen(port)
{
    const {options, group} = started;
    const relay = agent_relay(group);
    const out = {server: null, error: null};
    // What answering one visitor throws costs that visitor alone, as at the machine's own door
    const server = http.createServer(function (req, res) {
        agent_door_answer(options, relay, req, res).catch(function (error) {
            agent_say(group, 'door_request_error', {host: req.headers.host, path: req.url.split('?')[0], reason: error.message});
            agent_http_error(res, 500);
        });
    });
    server.on('upgrade', function (req, socket, head) {
        socket.on('error', function () {
            socket.destroy();
        });
        agent_door_answer.upgrade(options, relay, req, socket, head).catch(function (error) {
            agent_say(group, 'door_upgrade_error', {host: req.headers.host, path: req.url.split('?')[0], reason: error.message});
            socket.destroy();
        });
    });
    server.on('error', function (error) {
        out.error = error.message;
        agent_say(group, 'local_error', {at: `127.0.0.1:${port}`, reason: error.message});
    });
    out.server = server;
    server.listen({host: '127.0.0.1', port}, function () {
        agent_say(group, 'local_listen', {at: `127.0.0.1:${port}`});
    });
    return out;
}

module.exports = agent_local_serve;
