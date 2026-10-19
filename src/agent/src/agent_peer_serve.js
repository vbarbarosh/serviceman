const agent_addresses = require('./agent_addresses');
const agent_door_proxy = require('./agent_door_proxy');
const agent_door_upgrade = require('./agent_door_upgrade');
const agent_doors_state = require('./agent_doors_state');
const agent_http_error = require('./agent_http_error');
const agent_say = require('./agent_say');
const agent_service_target = require('./agent_service_target');
const crypto = require('crypto');
const http = require('http');
const log_uid = require('../../helpers/log_uid');

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
function agent_peer_serve(options, group)
{
    const port = (options.peer_port === '') ? PEER_PORT : parseInt(options.peer_port, 10);
    if ((port === 0) || Number.isNaN(port)) {
        return;
    }
    const hosts = (options.peer_host === '') ? agent_addresses().filter(is_tailnet) : [options.peer_host];
    if (hosts.length === 0) {
        agent_say(group, 'peer_serve_off', {reason: 'this machine has no tailnet address'});
        return;
    }
    const listening = [];
    for (const host of hosts) {
        const server = http.createServer(function (req, res) {
            peer_answer(options, req, res);
        });
        server.on('upgrade', function (req, socket, head) {
            peer_upgrade(options, req, socket, head);
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

// Whether two tokens are one, in the same time whatever they are
function same(given, wanted)
{
    const a = Buffer.from(given);
    const b = Buffer.from(String(wanted));
    return (a.length === b.length) && (a.length > 0) && crypto.timingSafeEqual(a, b);
}

// A tailnet address: tailscale's 100.64.0.0/10, and its fd7a:115c:a1e0::/48
function is_tailnet(address)
{
    const v4 = /^100\.(\d+)\./.exec(address);
    if (v4 !== null) {
        const second = Number(v4[1]);
        return (second >= 64) && (second <= 127);
    }
    return address.toLowerCase().startsWith('fd7a:115c:a1e0:');
}

module.exports = agent_peer_serve;
