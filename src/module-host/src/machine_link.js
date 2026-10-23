const agent_serve = require('../../agent/src/agent_serve');
const fs = require('fs');
const link_read = require('../../helpers/link_read');
const link_send_message = require('../../helpers/link_send_message');
const log_uid = require('../../helpers/log_uid');
const net = require('net');
const os = require('os');
const path = require('path');
const tunnel_read = require('../../main/src/helpers/tunnel_read');

const TUNNEL_KINDS = ['d', 'e', 'x', 'r'];
// How long a link that dropped waits before it is joined again
const AGAIN_MS = 1000;

// This computer as serviceman sees a machine: the ServiceMan agent's own code, run in this
// process and joined to it by a socket file of its own. Every module is then answered through
// the same calls, streams and helpers serviceman uses for a machine whose agent dialled in —
// remote_call, remote_disk, tunnel_open — and the work is done here by the code that does it
// there, with no copy of either.
//
// What the agent keeps (its kept terminals, its log, a volume's links) goes to its folder,
// SERVICEMAN_AGENT_DIR, which the caller sets before this runs: never this checkout.
//
// The remote answers as serviceman's own does: {name, state: {phase, socket, calls, streams,
// resources, stats, apt, groups, ...}}, `phase` 'online' once the agent said hello.
function machine_link(app)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-host-'));
    const file = path.join(dir, 'link.sock');
    const out = {
        name: os.hostname(),
        state: {
            phase: 'connecting',
            socket: null,
            calls: {},
            next_call_id: 0,
            streams: {},
            next_stream_id: 0,
            resources: null,
            stats: null,
            connected_at: null,
            groups: new Set(),
            apt: {phase: 'idle', lines: [], started_at: null, ended_at: null, error: null, containers: null, stream: null, url: null},
        },
    };
    const server = net.createServer(function (socket) {
        link_join(app, out, socket);
    });
    server.listen(file, function () {
        agent_dial(file);
    });
    process.on('exit', function () {
        fs.rmSync(dir, {recursive: true, force: true});
    });
    return out;
}

// The agent's end: it serves the link as it serves the one it dials to serviceman, and dials
// again when it drops
function agent_dial(file)
{
    const options = {
        url: `unix:${file}`,
        machine: os.hostname(),
        tags: [],
        dir: '/',
        docker: process.env.SERVICEMAN_DOCKER || 'docker',
        apt: process.env.SERVICEMAN_APT || '',
        ufw: process.env.UFW || process.env.SERVICEMAN_UFW || '',
        root_socket: process.env.SERVICEMAN_ROOT_SOCKET || '',
        screenshot: '',
        http_socket_mode: '',
        peer_port: '0',
        peer_host: '',
    };
    const socket = net.connect(file);
    socket.once('connect', function () {
        agent_serve(options, socket, log_uid()).catch(function (error) {
            console.error(`module-host: the agent's end of the link failed — ${error.message}`);
        }).finally(function () {
            setTimeout(() => agent_dial(file), AGAIN_MS);
        });
    });
    socket.once('error', function (error) {
        console.error(`module-host: the agent could not join — ${error.message}`);
        setTimeout(() => agent_dial(file), AGAIN_MS);
    });
}

// This end: what serviceman does with a link an agent dialled, as much of it as a machine with
// no services needs — the hello, the beat answered, the answers to calls, and the streams
function link_join(app, remote, socket)
{
    const state = remote.state;
    state.socket = socket;
    link_read(socket, function (kind, body) {
        frame_read(app, remote, kind, body);
    });
    socket.on('error', function () {
        // The close below says the rest
    });
    socket.on('close', function () {
        link_gone(remote, socket);
    });
}

function frame_read(app, remote, kind, body)
{
    if (TUNNEL_KINDS.includes(kind)) {
        tunnel_read(remote, kind, body);
        return;
    }
    if (kind === 'b') {
        call_answer(remote, body.readUInt32BE(0), true, {bytes: body.length - 4});
        return;
    }
    // 'o' is somebody at the agent's http door, which module-host never opens
    if (kind !== 'm') {
        return;
    }
    const message = JSON.parse(body.toString('utf8'));
    const state = remote.state;
    if (message.type === 'beat') {
        link_send_message(state.socket, {type: 'beat'});
        return;
    }
    if (message.type === 'hello') {
        state.phase = 'online';
        state.connected_at = Date.now();
        state.resources = message.resources;
        state.stats = message.stats;
        return;
    }
    if (message.type === 'stats') {
        state.stats = message.stats;
        if (Array.isArray(message.stats.can) && (state.resources !== null)) {
            state.resources.can = message.stats.can;
        }
        return;
    }
    if (message.type === 'reply') {
        call_answer(remote, message.id, message.ok, message.ok ? message.value : message.error);
        return;
    }
    // The agent prints its own lines already; an upgrade's are also said to the page following it
    if ((message.type === 'log') && (typeof message.words === 'string') && (typeof message.service === 'string')) {
        app.service_said(remote, message.service, message.words);
    }
}

function call_answer(remote, id, ok, value)
{
    const call = remote.state.calls[id];
    if (call === undefined) {
        return;
    }
    delete remote.state.calls[id];
    clearTimeout(call.timer);
    if (ok) {
        call.resolve(value);
        return;
    }
    call.reject(new Error(value));
}

// Nothing waits for an answer that cannot come
function link_gone(remote, socket)
{
    const state = remote.state;
    if (state.socket !== socket) {
        return;
    }
    state.socket = null;
    state.phase = 'connecting';
    for (const id of Object.keys(state.calls)) {
        const call = state.calls[id];
        delete state.calls[id];
        clearTimeout(call.timer);
        call.reject(new Error('the link to the agent dropped before the answer came'));
    }
    for (const id of Object.keys(state.streams)) {
        const dropped = new Error('the link to the agent dropped');
        dropped.code = 'ECONNRESET';
        state.streams[id].tunnel_gone(dropped);
    }
    state.streams = {};
}

module.exports = machine_link;
