const agent_addresses = require('./agent_addresses');
const agent_door_proxy = require('./agent_door_proxy');
const agent_door_upgrade = require('./agent_door_upgrade');
const agent_doors_state = require('./agent_doors_state');
const agent_http_error = require('./agent_http_error');
const agent_path_expand = require('./agent_path_expand');
const agent_peer_stream = require('./agent_peer_stream');
const agent_say = require('./agent_say');
const agent_service_target = require('./agent_service_target');
const crypto = require('crypto');
const http = require('http');
const is_tailnet_address = require('../../helpers/is_tailnet_address');
const log_uid = require('../../helpers/log_uid');
const net = require('net');
const sftp_stream = require('../../helpers/sftp_stream');

// The port the machines' agents reach each other on, over the tailnet
const PEER_PORT = 7303;

// Where this agent listens for its peers, for the host to write into every machine's table:
// {port, addresses}, or null for an agent that does not
const where = {now: null};

// How another machine's door reaches a service that runs here: its agent asks this one, over
// the tailnet, with the token serviceman gave this machine, naming the service it means — and
// this agent finds that service on its own machine, the way its own door would, waking it if
// it sleeps. Nothing but the machine's tailnet addresses is listened on: the token is the only
// thing between a caller and every service here, and the tailnet is who may be a caller at all.
//
// A forward or a mount whose far end is here is asked for the same way, as a stream
// (peer_stream): the bytes go straight between the two machines' agents.
function agent_peer_serve(options, group)
{
    const port = (options.peer_port === '') ? PEER_PORT : parseInt(options.peer_port, 10);
    if ((port === 0) || Number.isNaN(port)) {
        return;
    }
    const hosts = (options.peer_host === '') ? agent_addresses().filter(is_tailnet_address) : [options.peer_host];
    if (hosts.length === 0) {
        agent_say(group, 'peer_serve_off', {reason: 'this machine has no tailnet address'});
        return;
    }
    const listening = [];
    for (const host of hosts) {
        // What answering one caller throws costs that caller alone, a 500 or a closed socket,
        // and a line in the log: thrown out of here it would end the agent, and with it this
        // machine's link and its door.
        const server = http.createServer(function (req, res) {
            peer_answer(options, req, res).catch(function (error) {
                agent_say(group, 'peer_request_error', {path: req.url.split('?')[0], reason: error.message});
                agent_http_error(res, 500);
            });
        });
        server.on('upgrade', function (req, socket, head) {
            // The socket's own error is heard before anything is asked or written. A caller
            // that resets behind its handshake makes the answer a write error: heard, it costs
            // that socket; unheard, it ends the agent, and no token is needed for it.
            socket.on('error', function () {
                socket.destroy();
            });
            if (String(req.headers.upgrade || '').toLowerCase() === agent_peer_stream.STREAM_UPGRADE) {
                peer_stream(req, socket, head);
                return;
            }
            peer_upgrade(options, req, socket, head).catch(function (error) {
                agent_say(group, 'peer_upgrade_error', {path: req.url.split('?')[0], reason: error.message});
                socket.destroy();
            });
        });
        server.on('error', function (error) {
            agent_say(group, 'peer_serve_error', {host, port, reason: error.message});
        });
        server.listen(port, host, function () {
            listening.push(host);
            where.now = {port, addresses: listening.slice()};
            agent_say(group, 'peer_serve_begin', {host, port});
        });
    }
}

agent_peer_serve.where = function () {
    return where.now;
};

async function peer_answer(options, req, res)
{
    const found = peer_service(req);
    const group = log_uid();
    agent_say(group, 'group_spawn', undefined);
    agent_say(group, 'peer_request', {service: found.service || '', path: req.url.split('?')[0], refused: found.refused});
    if (found.refused !== undefined) {
        agent_http_error(res, found.status);
        return;
    }
    const target = await agent_service_target(agent_doors_state.table, found.service, options);
    if (target === null) {
        agent_say(group, 'peer_request_refused', {service: found.service, why: 'not running here, and it cannot be started without serviceman'});
        agent_http_error(res, 502);
        return;
    }
    agent_doors_state.seen[found.service] = Date.now();
    if (await agent_door_proxy(req, res, target, {}) === false) {
        agent_service_target.forget(found.service);
    }
}

async function peer_upgrade(options, req, socket, head)
{
    const found = peer_service(req);
    const target = (found.refused === undefined) ? await agent_service_target(agent_doors_state.table, found.service, options) : null;
    if (target === null) {
        socket.end('HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\ncontent-length: 0\r\n\r\n');
        return;
    }
    agent_door_upgrade(req, socket, head, target, {});
}

// The service a peer asks for, once its token is this machine's and the service runs here —
// with the asking taken off the request, so what reaches the service is what the visitor sent
function peer_service(req)
{
    const table = agent_doors_state.table;
    const token = String(req.headers['x-serviceman-peer'] || '');
    const service = String(req.headers['x-serviceman-service'] || '');
    delete req.headers['x-serviceman-peer'];
    delete req.headers['x-serviceman-service'];
    if ((table === null) || (same(token, table.token) === false)) {
        return {status: 403, refused: 'not a machine of this fleet'};
    }
    const where_is = table.services[service];
    if ((where_is === undefined) || (where_is.machine !== table.self)) {
        return {status: 404, refused: `${service || 'that'} does not run on ${table.self}`};
    }
    return {service};
}

// A stream another machine's agent asks for: a forward whose service is here, or a mount of a
// folder here, by the name serviceman wrote into this machine's table, and nothing else — the
// token opens what serviceman said and no more. Answered 101 once this end is open, then joined
// byte for byte until either end closes; refused with a status and the reason otherwise, 502
// with the service's own when it refused.
function peer_stream(req, socket, head)
{
    const group = log_uid();
    const found = stream_of(req);
    agent_say(group, 'group_spawn', undefined);
    agent_say(group, 'peer_stream', {kind: found.kind || '', name: found.name || '', refused: found.refused});
    if (found.refused !== undefined) {
        stream_refuse(socket, found.status, found.refused);
        return;
    }
    if (found.kind === 'mount') {
        stream_join(socket, head, sftp_stream(agent_path_expand(found.entry.path), {read_only: found.entry.mode !== 'rw'}), group);
        return;
    }
    const dial = found.entry;
    const far = net.connect(Object.assign({allowHalfOpen: true}, (dial.path === undefined) ? {host: (dial.host === undefined) ? '127.0.0.1' : dial.host, port: dial.port} : {path: agent_path_expand(dial.path)}));
    function refused(error) {
        agent_say(group, 'peer_stream_error', {reason: error.message});
        stream_refuse(socket, 502, error.message);
    }
    far.once('error', refused);
    far.once('connect', function () {
        far.removeListener('error', refused);
        stream_join(socket, head, far, group);
    });
}

// The stream's two ends, joined once this one is open: what the asking agent sent before the
// answer goes first
function stream_join(socket, head, far, group)
{
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: ${agent_peer_stream.STREAM_UPGRADE}\r\n\r\n`);
    if (head.length > 0) {
        far.write(head);
    }
    far.on('error', function (error) {
        agent_say(group, 'peer_stream_error', {reason: error.message});
        socket.destroy();
    });
    socket.on('error', function () {
        far.destroy();
    });
    // One end gone with no word that it was done: the other is ended, what it holds still
    // written first, so nothing is left open behind it
    socket.on('close', function () {
        far.end();
    });
    far.on('close', function () {
        socket.end();
    });
    socket.pipe(far);
    far.pipe(socket);
}

// The forward or the mount a peer asks for, once its token is this machine's and serviceman
// wrote that name into the table: {kind, name, entry}, or {status, refused}
function stream_of(req)
{
    const table = agent_doors_state.table;
    const token = String(req.headers['x-serviceman-peer'] || '');
    // A machine nobody was told to ask has no token, and nobody opens anything on it
    if ((table === null) || (typeof table.token !== 'string') || (same(token, table.token) === false)) {
        return {status: 403, refused: 'not a machine of this fleet'};
    }
    const matched = /^\/(forward|mount)\/([^/?]+)$/.exec(req.url);
    if (matched === null) {
        return {status: 400, refused: 'a stream is /forward/<name> or /mount/<name>'};
    }
    let name;
    try {
        name = decodeURIComponent(matched[2]);
    }
    catch {
        return {status: 400, refused: 'a name written wrong'};
    }
    const kind = matched[1];
    const streams = ((table.streams === undefined) || (table.streams === null)) ? {} : table.streams[`${kind}s`];
    const entry = ((streams === undefined) || (Object.hasOwn(streams, name) === false)) ? undefined : streams[name];
    if (entry === undefined) {
        return {kind, name, status: 404, refused: `${table.self} has no ${kind} named ${name} to open`};
    }
    return {kind, name, entry};
}

function stream_refuse(socket, status, reason)
{
    const body = Buffer.from(reason);
    socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: ${body.length}\r\nconnection: close\r\n\r\n${reason}`);
}

// Whether two tokens are one, in the same time whatever they are; a machine that keeps no token
// (null: nobody is told to ask it) matches no caller, whatever word it sends
function same(given, wanted)
{
    if (typeof wanted !== 'string') {
        return false;
    }
    const a = Buffer.from(given);
    const b = Buffer.from(wanted);
    return (a.length === b.length) && (a.length > 0) && crypto.timingSafeEqual(a, b);
}

module.exports = agent_peer_serve;
