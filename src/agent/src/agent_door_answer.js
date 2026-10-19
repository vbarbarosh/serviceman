const agent_door_proxy = require('./agent_door_proxy');
const agent_door_rule = require('./agent_door_rule');
const agent_door_upgrade = require('./agent_door_upgrade');
const agent_doors_state = require('./agent_doors_state');
const agent_http_error = require('./agent_http_error');
const agent_say = require('./agent_say');
const agent_service_target = require('./agent_service_target');
const agent_wall_ask = require('./agent_wall_ask');
const http = require('http');
const log_uid = require('../../helpers/log_uid');

// One request through this machine's door, routed here: the name's rule, the wall in front of
// it asked first, and the service behind it reached straight — on this machine, or through the
// agent of the machine it runs on. Only a wall that was reached and said yes lets a request
// through; a wall that cannot be asked is a closed door.
//
// Whatever the table cannot route — a name it was not given, a service this machine cannot
// reach — is handed to serviceman over the link, as the door did before it had a table, and
// serviceman answers it by its own rules.
async function agent_door_answer(options, relay, req, res)
{
    const group = log_uid();
    const time0 = Date.now();
    const host = host_of(req);
    agent_say(group, 'group_spawn', undefined);
    agent_say(group, 'door_request_begin', {method: req.method, host, path: path_of(req.url)});
    res.once('close', function () {
        agent_say(group, 'door_request_end', {status: res.writableEnded ? res.statusCode : 'cut_off', took: `${((Date.now() - time0)/1000).toFixed(3)}s`});
    });
    mark(req);
    const routed = await route(options, req, host, group);
    if (routed.answer !== undefined) {
        answer_now(res, routed.answer, group);
        return;
    }
    if (routed.target === null) {
        await relay_to_serviceman(relay, req, res, group);
        return;
    }
    if (routed.target.peer === undefined) {
        agent_doors_state.seen[routed.service] = Date.now();
    }
    const reached = await agent_door_proxy(req, res, routed.target, routed.extra);
    if (reached === false) {
        agent_service_target.forget(routed.service);
    }
}

// The same for a connection that asks to become a websocket: routed the same way, then carried
// on as bytes
agent_door_answer.upgrade = async function (options, relay, req, socket, head) {
    const group = log_uid();
    const host = host_of(req);
    agent_say(group, 'group_spawn', undefined);
    agent_say(group, 'door_upgrade_begin', {host, path: path_of(req.url)});
    mark(req);
    const routed = await route(options, req, host, group);
    if (routed.answer !== undefined) {
        if (routed.answer.why !== undefined) {
            agent_say(group, 'door_request_refused', {status: routed.answer.status, why: routed.answer.why});
        }
        socket.end(`HTTP/1.1 ${routed.answer.status} ${http.STATUS_CODES[routed.answer.status]}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
        return;
    }
    if (routed.target === null) {
        if (agent_doors_state.link === null) {
            agent_say(group, 'door_request_refused', {status: 503, why: 'not in this machine’s table, and serviceman is not connected'});
            socket.end('HTTP/1.1 503 Service Unavailable\r\nconnection: close\r\ncontent-length: 0\r\n\r\n');
            return;
        }
        agent_door_upgrade(req, socket, head, {socket: relay}, {});
        return;
    }
    agent_door_upgrade(req, socket, head, routed.target, routed.extra);
};

// Where this request goes: {target, extra, service}, {target: null} for serviceman to decide, or
// {answer} for one this door gives itself
async function route(options, req, host, group)
{
    const table = agent_doors_state.table;
    const rule = agent_door_rule(table, host);
    if (rule === null) {
        return {target: null};
    }
    if (rule.off) {
        return {answer: {status: 404, why: `${host} is switched off`}};
    }
    // Whatever a visitor claims to be is not taken from them: only the wall says who they are
    delete req.headers['x-auth-user'];
    const own = (rule.wall !== null) && agent_wall_ask.own(req.url);
    const name = own ? rule.wall : rule.service;
    if ((rule.wall !== null) && (own === false)) {
        const wall = await agent_service_target(table, rule.wall, options);
        if (wall === null) {
            return {target: null};
        }
        const said = await agent_wall_ask(wall, req, host, peer_headers(wall));
        if (said.said === 'unreachable') {
            agent_service_target.forget(rule.wall);
            return {answer: {status: 502, why: `${rule.wall} cannot be asked, so nothing behind it is served`}};
        }
        if (said.said === 'no') {
            agent_say(group, 'door_wall_refused', {wall: rule.wall, host, path: path_of(req.url)});
            return {answer: {status: 302, location: agent_wall_ask.sign_in(req)}};
        }
        req.headers['x-auth-user'] = said.user;
    }
    const target = await agent_service_target(table, name, options);
    if (target === null) {
        return {target: null};
    }
    return {target, extra: peer_headers(target), service: name};
}

// Everything a door carries came from outside: a service that lets more in at home (a pairing,
// a first sign-in) reads it here. Set over whatever the visitor sent, so nobody takes it off.
function mark(req)
{
    req.headers['x-serviceman-relay'] = '1';
}

// What a peer is asked with: its token and the service meant, which the peer finds on its own
// machine
function peer_headers(target)
{
    if (target.peer === undefined) {
        return {};
    }
    return {'x-serviceman-peer': target.peer.token, 'x-serviceman-service': target.peer.service};
}

// Handed to serviceman as it was: over the link, which it reads as this machine's door
async function relay_to_serviceman(relay, req, res, group)
{
    if (agent_doors_state.link === null) {
        answer_now(res, {status: 503, why: 'not in this machine’s table, and serviceman is not connected'}, group);
        return;
    }
    await agent_door_proxy(req, res, {socket: relay}, {});
}

// What this door answers itself: a redirect to sign in, or a standard error with its reason in
// this machine's log
function answer_now(res, answer, group)
{
    if (answer.location !== undefined) {
        res.writeHead(answer.status, {location: answer.location, 'cache-control': 'no-store'});
        res.end();
        return;
    }
    agent_say(group, 'door_request_refused', {status: answer.status, why: answer.why});
    agent_http_error(res, answer.status);
}

function host_of(req)
{
    return String(req.headers.host || '').toLowerCase().split(':')[0];
}

function path_of(url)
{
    const mark = url.indexOf('?');
    return (mark === -1) ? url : url.slice(0, mark);
}

module.exports = agent_door_answer;
