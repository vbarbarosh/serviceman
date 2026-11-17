const agent_dir = require('./agent_dir');
const agent_doors_state = require('./agent_doors_state');
const agent_peer_stream = require('./agent_peer_stream');
const agent_root_ask = require('./agent_root_ask');
const agent_say = require('./agent_say');
const agent_stream_counts = require('./agent_stream_counts');
const agent_tunnel = require('./agent_tunnel');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

// The longest path a socket file may have on Linux, the ending zero left out
const SOCKET_PATH_MAX = 107;
// A socket's name in its folder: a sum of the label, of this many hex digits, and .sock
const SOCKET_NAME_LENGTH = 16 + '.sock'.length;

// The sockets this machine listens on for its mounts, by label: {label: {file, server, error,
// peer}}. They stand for the life of the agent, as a forward's do: sshfs dials one again after
// a blink of the link, and finds it there.
const listening = {};

// What went through the mounts this agent joins itself, since serviceman was last told
const counts = agent_stream_counts();

// The folders of other machines serviceman says to mount here. Each gets a socket file of the
// agent's user, which the mount's sshfs dials through `--pipe` in place of ssh; whatever
// connects there is carried over the link as a stream named for the mount, and serviceman
// joins it to the folder's own machine. The root half mounts them (agent_mounts).
//
// A mount that comes with `peer`, where the folder's machine's agent listens, goes straight
// there instead, over the tailnet, and that agent serves the folder (agent_peer_stream); a peer
// that does not answer leaves it to the link, as before.
//
// mounts: [{name, path, mode, peer}], peer {addresses, port, token} or left out. Answers
// {root, items: [{label, path, mode, state, error}], leaving}.
async function agent_mounts_set(options, mounts, group)
{
    const wanted = {};
    for (const item of mounts) {
        wanted[item.name] = item;
    }
    for (const label of Object.keys(listening)) {
        if (wanted[label] === undefined) {
            close(listening[label]);
            delete listening[label];
            agent_say(group, 'mount_socket_close', {mount: label});
        }
    }
    let dir;
    try {
        dir = sockets_dir();
    }
    catch (error) {
        return {root: false, items: mounts.map(v => item_refused(v, error.message)), leaving: []};
    }
    for (const label of Object.keys(wanted)) {
        if ((listening[label] === undefined) || (listening[label].error !== null)) {
            if (listening[label] !== undefined) {
                close(listening[label]);
            }
            listening[label] = await listen(dir, label, group);
        }
        listening[label].peer = (wanted[label].peer === undefined) ? null : wanted[label].peer;
    }
    counts.keep(Object.keys(listening).filter(v => listening[v].peer !== null));
    const table = {mounts: Object.values(wanted).map(v => ({label: v.name, path: v.path, mode: v.mode, socket: listening[v.name].file}))};
    let answer;
    try {
        answer = await agent_root_ask(options, 'mounts', {action: 'apply', table});
    }
    catch (error) {
        if (error.code !== 'NOROOT') {
            throw error;
        }
        const why = (error.root_old === true) ? 'its root half is from before mounts; it updates itself within half a minute' : `no root half to mount with: sudo ${path.join(agent_dir(), 'bin', 'install-root')}`;
        return {root: false, items: mounts.map(v => item_refused(v, why)), leaving: []};
    }
    if (answer.ok === false) {
        return {root: true, items: mounts.map(v => item_refused(v, answer.error)), leaving: []};
    }
    // A socket that could not listen is the mount's reason, whatever the root half found
    const items = answer.items.map(function (item) {
        const found = listening[item.label];
        return ((found !== undefined) && (found.error !== null)) ? Object.assign({}, item, {state: 'error', error: found.error}) : item;
    });
    return {root: true, items, leaving: answer.leaving};
}

// The folder of the sockets: the agent's own, unless its path is too long for a socket file or
// has what sshfs cannot take in its ssh command (a space, a comma); then a folder of this user's
// alone in the temp folder, which nobody else may have made first
function sockets_dir()
{
    const own = path.join(agent_dir(), 'mounts');
    if ((Buffer.byteLength(path.join(own, 'x'.repeat(SOCKET_NAME_LENGTH))) <= SOCKET_PATH_MAX) && (/[\s,]/.test(own) === false)) {
        fs.mkdirSync(own, {recursive: true, mode: 0o700});
        return own;
    }
    const uid = process.getuid();
    const out = path.join(os.tmpdir(), `serviceman-mounts-${uid}`);
    try {
        fs.mkdirSync(out, {mode: 0o700});
    }
    catch (error) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }
    const stat = fs.lstatSync(out);
    if ((stat.isDirectory() === false) || (stat.uid !== uid) || ((stat.mode & 0o077) !== 0)) {
        throw new Error(`${out} is not a folder of this user's alone, and the agent's own ${own} is too long a path for a socket file`);
    }
    if ((Buffer.byteLength(path.join(out, 'x'.repeat(SOCKET_NAME_LENGTH))) > SOCKET_PATH_MAX) || /[\s,]/.test(out)) {
        throw new Error(`neither ${own} nor ${out} can hold a socket file sshfs dials: too long a path, or a space or a comma in it`);
    }
    return out;
}

async function listen(dir, label, group)
{
    const file = path.join(dir, `${crypto.createHash('sha256').update(label).digest('hex').slice(0, 16)}.sock`);
    const out = {file, server: null, error: null, peer: null};
    const server = net.createServer({allowHalfOpen: true}, function (socket) {
        socket.on('error', function () {
            socket.destroy();
        });
        if (out.peer !== null) {
            through_peer(label, socket, out.peer);
            return;
        }
        through_link(label, socket);
    });
    try {
        fs.rmSync(file, {force: true});
        await new Promise(function (resolve, reject) {
            server.once('error', reject);
            server.listen({path: file}, function () {
                server.removeListener('error', reject);
                resolve();
            });
        });
        fs.chmodSync(file, 0o600);
    }
    catch (error) {
        out.error = `${file}: ${error.message}`;
        agent_say(group, 'mount_socket_error', {mount: label, at: file, reason: error.message});
        return out;
    }
    server.on('error', function (error) {
        out.error = error.message;
    });
    out.server = server;
    agent_say(group, 'mount_socket_listen', {mount: label, at: file});
    return out;
}

// sshfs's pipe, straight to the agent of the folder's machine. What it sends meanwhile waits in
// the socket. That agent refused: closed, serviceman hears why, and sshfs tries again; the peer
// did not answer: through the link, as before.
function through_peer(label, near, peer)
{
    agent_peer_stream(peer, 'mount', label).then(function (far) {
        if (near.destroyed) {
            far.destroy();
            return;
        }
        counts.join(label, near, far);
    }, function (error) {
        if (near.destroyed) {
            return;
        }
        if (error.code === 'EPEERREFUSED') {
            counts.failed(label, error.message);
            near.destroy();
            return;
        }
        counts.away(label, error.message);
        through_link(label, near);
    });
}

// Over the link, for serviceman to join to the folder's machine. No link: refused at once, and
// sshfs tries again.
function through_link(label, near)
{
    if (agent_doors_state.link === null) {
        near.destroy();
        return;
    }
    agent_tunnel.open(agent_doors_state.link, near, {mount: label});
}

// What went through the mounts this agent joins itself since the last time, for serviceman's
// page: {label: {open, total, bytes_sent, bytes_back, failed}}, or null when nothing moved
agent_mounts_set.counts_take = function () {
    return counts.take();
};

// A new link is told the connections open now at its first telling, whatever the last one heard
agent_mounts_set.counts_retell = function () {
    counts.retell();
};

function close(found)
{
    if (found.server !== null) {
        found.server.close();
    }
}

function item_refused(item, error)
{
    return {label: item.name, path: item.path, mode: item.mode, state: 'cannot', error};
}

module.exports = agent_mounts_set;
