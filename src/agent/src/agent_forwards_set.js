const agent_doors_state = require('./agent_doors_state');
const agent_path_expand = require('./agent_path_expand');
const agent_peer_stream = require('./agent_peer_stream');
const agent_say = require('./agent_say');
const agent_stream_counts = require('./agent_stream_counts');
const agent_tunnel = require('./agent_tunnel');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const tls = require('tls');

// The forwards this machine listens for, by name: {name: {key, where, server, error, dial,
// peer}}. They stand for the life of the agent, not of a link: a socket file that came and went
// with every redial would be a file that is missing exactly when the wifi blinks.
const listening = {};

// What went through the forwards this agent joins itself, since serviceman was last told
const counts = agent_stream_counts();

// The forwards serviceman says start on this machine: each a socket file or a port on its
// loopback. Whatever connects there is carried over the link as a stream named for the forward,
// and serviceman joins it to the other end. A forward not in the list any more is closed.
//
// A forward whose other end is on this machine too comes with `dial`, that end: the agent joins
// the two itself, and the bytes go straight there, never through serviceman, link or no link.
// One whose other end is on another machine comes with `peer`, where that machine's agent
// listens: each connection goes straight there, over the tailnet (agent_peer_stream); a peer
// that does not answer leaves it to the link, as before.
//
// A port may listen beyond the loopback, `host` 0.0.0.0, on every address of the machine: a
// public port, joined to a port of this machine (`dial`). `tls` {cert, key} makes it speak TLS
// with that certificate, its far end spoken to plainly as before; `allow`, addresses and
// networks (203.0.113.5, 10.0.0.0/8), lets in those alone, before a TLS handshake is begun.
//
// forwards: [{name, socket}] or [{name, port, host, tls, allow}], each with `dial` ({host,
// port}, {port} or {path}), `peer` ({addresses, port, token}) or neither. Answers what each one
// is now: {name: {at, error}}, error null for one that listens.
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
        listening[name].peer = (wanted[name].peer === undefined) ? null : wanted[name].peer;
    }
    counts.keep(Object.keys(listening).filter(v => (listening[v].dial !== null) || (listening[v].peer !== null)));
    const out = {};
    for (const name of Object.keys(listening)) {
        out[name] = {at: listening[name].where, error: listening[name].error};
    }
    return out;
}

async function listen(item, group)
{
    const host = (item.host === undefined) ? '127.0.0.1' : item.host;
    const where = (item.socket === undefined) ? `${host}:${item.port}` : agent_path_expand(item.socket);
    const out = {key: key_of(item), where, server: null, error: null, dial: null, peer: null};
    const admitted = allow_list(item.allow);
    // Half open, as ssh -L is: a client that says it is done is still sent the answer
    function accept(socket) {
        socket.on('error', function () {
            socket.destroy();
        });
        if (admitted(socket) === false) {
            socket.destroy();
            return;
        }
        if (out.dial !== null) {
            join(item.name, socket, out.dial);
            return;
        }
        if (out.peer !== null) {
            through_peer(item.name, socket, out.peer);
            return;
        }
        through_link(item.name, socket);
    }
    const server = (item.tls === undefined) ? net.createServer({allowHalfOpen: true}, accept) : tls.createServer({allowHalfOpen: true, cert: item.tls.cert, key: item.tls.key}, accept);
    if (item.tls !== undefined) {
        // One not let in is closed before its handshake; a handshake that fails is that
        // client's alone
        server.on('connection', function (raw) {
            if (admitted(raw) === false) {
                raw.destroy();
            }
        });
        server.on('tlsClientError', function (error, raw) {
            raw.destroy();
        });
    }
    try {
        if (item.socket === undefined) {
            await server_listen(server, {host, port: item.port});
        }
        else {
            // A folder of its own for the sockets, ~/.sockets/, is made the first time, for the
            // agent's user alone
            fs.mkdirSync(path.dirname(where), {recursive: true, mode: 0o700});
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
    const options = (dial.path === undefined) ? {host: (dial.host === undefined) ? '127.0.0.1' : dial.host, port: dial.port} : {path: agent_path_expand(dial.path)};
    counts.join(name, near, net.connect(Object.assign({allowHalfOpen: true}, options)));
}

// A connection to a forward whose service is on another machine, straight to that machine's
// agent. What it sends meanwhile waits in the socket. The service there refused: closed, and
// serviceman hears why; the peer did not answer: through the link, as before.
function through_peer(name, near, peer)
{
    agent_peer_stream(peer, 'forward', name).then(function (far) {
        if (near.destroyed) {
            far.destroy();
            return;
        }
        counts.join(name, near, far);
    }, function (error) {
        if (near.destroyed) {
            return;
        }
        if (error.code === 'EPEERREFUSED') {
            counts.failed(name, error.message);
            near.destroy();
            return;
        }
        counts.away(name, error.message);
        through_link(name, near);
    });
}

// Over the link, for serviceman to join to the other end. No link: refused at once rather than
// left to hang; the next connect after the redial goes through.
function through_link(name, near)
{
    if (agent_doors_state.link === null) {
        near.destroy();
        return;
    }
    agent_tunnel.open(agent_doors_state.link, near, {forward: name});
}

// What went through the forwards this agent joins itself since the last time, for serviceman's
// page: {name: {open, total, bytes_sent, bytes_back, failed}}, or null when nothing moved
agent_forwards_set.counts_take = function () {
    return counts.take();
};

// A new link is told the connections open now at its first telling, whatever the last one heard
agent_forwards_set.counts_retell = function () {
    counts.retell();
};

// Nothing new is let in, and the socket file goes with it; the connections open now finish on
// their own
function close(found)
{
    if (found.server !== null) {
        found.server.close();
    }
}

// What a listener is: a new key opens it again. A certificate is told by its fingerprint.
function key_of(item)
{
    if (item.socket !== undefined) {
        return `socket ${item.socket}`;
    }
    const tls_key = (item.tls === undefined) ? '' : ` tls ${crypto_hash(item.tls.cert)}`;
    const allow_key = (item.allow === undefined) ? '' : ` allow ${item.allow.join(',')}`;
    return `port ${(item.host === undefined) ? '127.0.0.1' : item.host}:${item.port}${tls_key}${allow_key}`;
}

function crypto_hash(text)
{
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// Whether a connection may come in: every one when there is no list, else the ones from an
// address or a network on it. An IPv4 address that arrives as IPv6 (::ffff:203.0.113.5) is
// taken as itself.
function allow_list(allow)
{
    if (allow === undefined) {
        return function () {
            return true;
        };
    }
    const list = new net.BlockList();
    for (const item of allow) {
        const [address, prefix] = item.split('/');
        const type = net.isIPv6(address) ? 'ipv6' : 'ipv4';
        if (prefix === undefined) {
            list.addAddress(address, type);
        }
        else {
            list.addSubnet(address, Number(prefix), type);
        }
    }
    return function (socket) {
        const address = String(socket.remoteAddress).replace(/^::ffff:(?=\d+\.)/, '');
        return list.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');
    };
}

module.exports = agent_forwards_set;
