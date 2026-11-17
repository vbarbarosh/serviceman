const agent_doors_state = require('./agent_doors_state');
const agent_path_expand = require('./agent_path_expand');
const agent_say = require('./agent_say');
const agent_tunnel = require('./agent_tunnel');
const fs = require('fs');
const net = require('net');

// The forwards this machine listens for, by name: {name: {key, where, server, error, dial}}.
// They stand for the life of the agent, not of a link: a socket file that came and went with
// every redial would be a file that is missing exactly when the wifi blinks.
const listening = {};

// What went through the forwards this agent joins itself, by name, since serviceman was last
// told (counts_take): {name: {open, total, bytes_sent, bytes_back, failed, told_open}}
const counts = {};

// The forwards serviceman says start on this machine: each a socket file or a port on its
// loopback. Whatever connects there is carried over the link as a stream named for the forward,
// and serviceman joins it to the other end. A forward not in the list any more is closed.
//
// A forward whose other end is on this machine too comes with `dial`, that end: the agent joins
// the two itself, and the bytes go straight there, never through serviceman, link or no link.
//
// forwards: [{name, socket}] or [{name, port}], each with `dial` ({host, port}, {port} or
// {path}) or without. Answers what each one is now: {name: {at, error}}, error null for one
// that listens.
async function agent_forwards_set(forwards, group)
{
    const wanted = {};
    for (const item of forwards) {
        wanted[item.name] = item;
    }
    for (const name of Object.keys(listening)) {
        const found = listening[name];
        if ((wanted[name] === undefined) || (key_of(wanted[name]) !== found.key) || (found.error !== null)) {
            close(found);
            delete listening[name];
            if (found.error === null) {
                agent_say(group, 'forward_close', {forward: name, at: found.where});
            }
        }
    }
    for (const name of Object.keys(wanted)) {
        if (listening[name] === undefined) {
            listening[name] = await listen(wanted[name], group);
        }
        // Where its far end is may change with the listener left as it is: the next connection
        // goes there
        listening[name].dial = (wanted[name].dial === undefined) ? null : wanted[name].dial;
    }
    for (const name of Object.keys(counts)) {
        if ((listening[name] === undefined) || (listening[name].dial === null)) {
            delete counts[name];
        }
    }
    const out = {};
    for (const name of Object.keys(listening)) {
        out[name] = {at: listening[name].where, error: listening[name].error};
    }
    return out;
}

async function listen(item, group)
{
    const where = (item.socket === undefined) ? `127.0.0.1:${item.port}` : agent_path_expand(item.socket);
    const out = {key: key_of(item), where, server: null, error: null, dial: null};
    // Half open, as ssh -L is: a client that says it is done is still sent the answer
    const server = net.createServer({allowHalfOpen: true}, function (socket) {
        socket.on('error', function () {
            socket.destroy();
        });
        if (out.dial !== null) {
            join(item.name, socket, out.dial);
            return;
        }
        // No link, no far end: refused at once rather than left to hang. The next connect after
        // the redial goes through.
        if (agent_doors_state.link === null) {
            socket.destroy();
            return;
        }
        agent_tunnel.open(agent_doors_state.link, socket, {forward: item.name});
    });
    try {
        if (item.socket === undefined) {
            await server_listen(server, {host: '127.0.0.1', port: item.port});
        }
        else {
            await socket_take(where);
            await server_listen(server, {path: where});
            fs.chmodSync(where, 0o600);
        }
    }
    catch (error) {
        out.error = error.message;
        agent_say(group, 'forward_listen_error', {forward: item.name, at: where, reason: error.message});
        return out;
    }
    // An error after the listen is the listener gone; the next telling opens it again
    server.on('error', function (error) {
        out.error = error.message;
    });
    out.server = server;
    agent_say(group, 'forward_listen', {forward: item.name, at: where});
    return out;
}

function server_listen(server, options)
{
    return new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(options, function () {
            server.removeListener('error', reject);
            resolve();
        });
    });
}

// A socket file left by a process that is gone is taken over; one somebody still answers on —
// an ssh -L doing the same job, say — is theirs, and the forward waits for it to go
function socket_take(file)
{
    return new Promise(function (resolve, reject) {
        if (fs.existsSync(file) === false) {
            resolve();
            return;
        }
        if (fs.lstatSync(file).isSocket() === false) {
            reject(new Error(`${file} is there and is not a socket`));
            return;
        }
        const probe = net.connect({path: file});
        probe.on('connect', function () {
            probe.destroy();
            reject(new Error(`${file} is answered by another program`));
        });
        probe.on('error', function () {
            try {
                fs.unlinkSync(file);
                resolve();
            }
            catch (error) {
                reject(error);
            }
        });
    });
}

// A connection to a forward whose two ends are this machine's, joined here, byte for byte, until
// either end closes: no stream over the link, and serviceman is told only what went through
function join(name, near, dial)
{
    const found = counts_of(name);
    const options = (dial.path === undefined) ? {host: (dial.host === undefined) ? '127.0.0.1' : dial.host, port: dial.port} : {path: agent_path_expand(dial.path)};
    const far = net.connect(Object.assign({allowHalfOpen: true}, options));
    found.open++;
    found.total++;
    near.on('data', function (chunk) {
        found.bytes_sent += chunk.length;
    });
    far.on('data', function (chunk) {
        found.bytes_back += chunk.length;
    });
    // The far end refused or broke: the near one goes with it, and serviceman hears why
    far.on('error', function (error) {
        found.failed = error.message;
        near.destroy();
    });
    near.on('error', function () {
        far.destroy();
    });
    let closed = 0;
    function close_one() {
        closed++;
        if (closed === 2) {
            found.open--;
        }
    }
    near.on('close', close_one);
    far.on('close', close_one);
    near.pipe(far);
    far.pipe(near);
}

function counts_of(name)
{
    if (counts[name] === undefined) {
        counts[name] = {open: 0, total: 0, bytes_sent: 0, bytes_back: 0, failed: null, told_open: null};
    }
    return counts[name];
}

// What went through the forwards this agent joins itself since the last time, for serviceman's
// page: {name: {open, total, bytes_sent, bytes_back, failed}}, the connections open now and what
// was added since, the reason of the last failure if there was a new one; null when nothing
// moved. What is taken is not counted again.
agent_forwards_set.counts_take = function () {
    let out = null;
    for (const name of Object.keys(counts)) {
        const found = counts[name];
        const moved = (found.total !== 0) || (found.bytes_sent !== 0) || (found.bytes_back !== 0) || (found.failed !== null) || (found.open !== found.told_open);
        if (moved === false) {
            continue;
        }
        out = (out === null) ? {} : out;
        out[name] = {open: found.open, total: found.total, bytes_sent: found.bytes_sent, bytes_back: found.bytes_back, failed: found.failed};
        Object.assign(found, {total: 0, bytes_sent: 0, bytes_back: 0, failed: null, told_open: found.open});
    }
    return out;
};

// A new link is told the connections open now at its first telling, whatever the last one heard
agent_forwards_set.counts_retell = function () {
    for (const name of Object.keys(counts)) {
        counts[name].told_open = null;
    }
};

// Nothing new is let in, and the socket file goes with it; the connections open now finish on
// their own
function close(found)
{
    if (found.server !== null) {
        found.server.close();
    }
}

function key_of(item)
{
    return (item.socket === undefined) ? `port ${item.port}` : `socket ${item.socket}`;
}

module.exports = agent_forwards_set;
