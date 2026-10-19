const agent_doors_state = require('./agent_doors_state');
const agent_shell = require('./agent_shell');
const http = require('http');
const link_send_message = require('../../helpers/link_send_message');
const timers = require('timers/promises');

// How long the port docker gave a container is taken on trust before it is asked again. A
// container made again gets another one; a connection that fails forgets it at once.
const KNOWN_MS = 15000;
// How long a container that was asleep is given to start answering
const WAKE_MS = 60000;
const WAKE_STEP_MS = 250;
// How long one of those asks may take
const ASK_MS = 2000;

const known = {};

// Where a service answers, for this machine's door: {host, port}, with `peer` when it is another
// machine's and has to be asked through that machine's agent — or null where this machine
// cannot reach it on its own, and serviceman has to carry the request.
//
// A service on this machine is found the way it is now, not the way it was written down: the
// port docker gave its container is asked of docker, and a container that is stopped is started
// here — which is what wakes a sleeping service with serviceman away. A container that does not
// exist is serviceman's to make.
async function agent_service_target(table, name, options)
{
    const where = (table === null) ? undefined : table.services[name];
    if ((where === undefined) || (where.machine === null)) {
        return null;
    }
    if (where.machine !== table.self) {
        const peer = table.peers[where.machine];
        if ((peer === undefined) || (peer.addresses.length === 0)) {
            return null;
        }
        return {host: peer.addresses[0], port: peer.port, peer: {token: peer.token, service: name}};
    }
    if (where.kind === 'external') {
        return address_of(where.upstream);
    }
    if (where.kind === 'program') {
        return {host: '127.0.0.1', port: where.port};
    }
    if (where.kind === 'docker') {
        return await docker_target(where, options);
    }
    return null;
}

// A container's address stops being trusted the moment a connection to it fails
agent_service_target.forget = function (name) {
    for (const key of Object.keys(known)) {
        if (key.startsWith(`${name}|`)) {
            delete known[key];
        }
    }
};

async function docker_target(where, options)
{
    const key = `${where.service}|${where.container}|${where.port}`;
    const kept = known[key];
    if ((kept !== undefined) && (Date.now() - kept.at < KNOWN_MS)) {
        return kept.target;
    }
    let target = await docker_port(where, options);
    if (target === null) {
        const running = await agent_shell([options.docker, 'inspect', '--format', '{{.State.Running}}', where.container]);
        if ((running.ok === false) || (running.stdout === 'true')) {
            return null;
        }
        const started = await agent_shell([options.docker, 'start', where.container]);
        if (started.ok === false) {
            return null;
        }
        target = await docker_port(where, options);
        if ((target === null) || (await answers(target, WAKE_MS) === false)) {
            return null;
        }
        // serviceman is told at once, so its page does not go on saying the service sleeps
        told_started(where.service);
    }
    known[key] = {target, at: Date.now()};
    return target;
}

// `127.0.0.1:32771`, or `0.0.0.0:32771` and `[::]:32771` for a port on every address — any of
// which is reached here on the loopback
async function docker_port(where, options)
{
    const said = await agent_shell([options.docker, 'port', where.container, `${where.port}/tcp`]);
    if ((said.ok === false) || (said.stdout === '')) {
        return null;
    }
    const line = said.stdout.split('\n')[0].trim();
    const at = line.lastIndexOf(':');
    const host = line.slice(0, at).replace(/^\[|\]$/g, '');
    const port = parseInt(line.slice(at + 1), 10);
    if (Number.isNaN(port)) {
        return null;
    }
    return {host: ((host === '0.0.0.0') || (host === '::') || (host === '')) ? '127.0.0.1' : host, port};
}

// Whether the program in there answers http before the time is up. A connection taken is not
// enough: docker's port is open the moment the container starts, long before the program behind
// it listens, and a request carried in then is dropped. Any answer at all will do — a 404 is a
// program that is up.
async function answers(target, within_ms)
{
    const until = Date.now() + within_ms;
    while (Date.now() < until) {
        if (await answers_http(target)) {
            return true;
        }
        await timers.setTimeout(WAKE_STEP_MS);
    }
    return false;
}

function answers_http(target)
{
    return new Promise(function (resolve) {
        const asking = http.request({host: target.host, port: target.port, method: 'GET', path: '/', agent: false, headers: {connection: 'close'}}, function (answer) {
            answer.resume();
            resolve(true);
        });
        asking.setTimeout(ASK_MS, function () {
            asking.destroy(new Error('no answer in time'));
        });
        asking.on('error', function () {
            resolve(false);
        });
        asking.end();
    });
}

// A container this agent started is one serviceman should know is up; with no link, it hears of
// it from the numbers the next time there is one
function told_started(service)
{
    const link = agent_doors_state.link;
    if (link === null) {
        return;
    }
    try {
        link_send_message(link.link, {type: 'door_started', service});
    }
    catch {
        // The link went as it was told; the numbers carry it when it is back
    }
}

// `127.0.0.1:8080`, `host:8080` or `http://host:8080` as an upstream is written
function address_of(upstream)
{
    const text = String(upstream).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const at = text.lastIndexOf(':');
    if (at === -1) {
        return {host: text, port: 80};
    }
    return {host: text.slice(0, at).replace(/^\[|\]$/g, ''), port: parseInt(text.slice(at + 1), 10)};
}

module.exports = agent_service_target;
