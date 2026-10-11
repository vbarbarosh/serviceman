#!/usr/bin/env node

// serviceman-agent 1.0.0 — one file, no dependencies.
// Built from the serviceman repo by src/agent/bin/build; change it there, not here.
// Run it on a machine that should carry services:
//
//     node serviceman-agent.js --url https://serviceman.example.com --token <secret>

const modules = {};
const loaded = {};

function load(key)
{
    if (loaded[key] === undefined) {
        loaded[key] = {exports: {}};
        modules[key](loaded[key], loaded[key].exports, from);
    }
    return loaded[key].exports;
}

// A module of the agent, or node's own
function from(name)
{
    const key = name.replace(/^\.\//, '');
    if (modules[key] === undefined) {
        return require(name);
    }
    return load(key);
}

modules["agent/index"] = function (module, exports, require) {

const agent_built = require('agent/src/agent_built');
const agent_bye = require('agent/src/agent_bye');
const agent_connect = require('agent/src/agent_connect');
const agent_doors_read = require('agent/src/agent_doors_read');
const agent_doors_state = require('agent/src/agent_doors_state');
const agent_http_serve = require('agent/src/agent_http_serve');
const agent_logline = require('agent/src/agent_logline');
const agent_peer_serve = require('agent/src/agent_peer_serve');
const agent_root_serve = require('agent/src/agent_root_serve');
const agent_root_socket = require('agent/src/agent_root_socket');
const agent_say = require('agent/src/agent_say');
const agent_serve = require('agent/src/agent_serve');
const agent_sleep_watch = require('agent/src/agent_sleep_watch');
const agent_status_ask = require('agent/src/agent_status_ask');
const agent_status_serve = require('agent/src/agent_status_serve');
const agent_uninstall = require('agent/src/agent_uninstall');
const format_seconds = require('helpers/format_seconds');
const log_uid = require('helpers/log_uid');
const os = require('os');
const package_json = require('../package.json');
const timers = require('timers/promises');

const AGENT_VERSION = package_json.version;
const FIRST_WAIT_MS = 1000;
const LONGEST_WAIT_MS = 5000;

const USAGE = `serviceman-agent --url <serviceman> --token <secret>

Runs on a machine that should carry services for a serviceman host. It dials the host,
says what this machine has, and waits for orders. Nothing listens here: the link goes out,
so this machine needs no open port and no public address.

The token says which remote this machine is — one token, one machine — so there is no name
to give and none to get wrong.

  --url     where serviceman answers (env SERVICEMAN_URL):
              http://host:port, https://host:port, or a socket file as
              unix:///run/serviceman.sock — which is what an ssh forward gives you
  --token   the token of this machine, or the join token of the fleet
            (env SERVICEMAN_TOKEN)
  --tag     what this machine is, for a service that asks for a tag instead of a
            name: --tag gpu --tag eu. Only read when joining with the join token,
            and only the tags that config allows are kept (env SERVICEMAN_TAGS,
            comma separated)
  --machine which machine this is, so it takes its own entry again when it comes
            back (env SERVICEMAN_MACHINE, default the hostname)
  --dir     the folder whose free space is reported (env SERVICEMAN_DIR, default /)
  --docker  the docker command on this machine (env SERVICEMAN_DOCKER, default docker)
  --apt     what apt-get is on this machine (env SERVICEMAN_APT). Without one,
            "sudo -n apt-get", or "apt-get" where the agent is root — so a
            sudoers line on that machine may name apt-get and nothing else
  --screenshot
            the line that writes a png of this screen, with %f for the file
            (env SERVICEMAN_SCREENSHOT). Without one, the usual ways are tried
            in turn and the answer says what each of them said
  --http-socket-mode
            opens the http socket beside this agent, and says who may knock at
            it, as a file mode (env SERVICEMAN_HTTP_SOCKET_MODE). Without one
            there is no socket: carrying requests in is off until it is asked
            for. Each request is routed by this machine's door table — to the
            wall in front of the name, then to the service, here or on another
            machine — with serviceman connected or not; what the table does not
            route goes to serviceman over the link. 0660 and a group is the
            usual way to let one in; 0600 is this user alone
  --peer-port
            the port other machines' agents reach this one on, over the tailnet,
            for the services that run here (env SERVICEMAN_PEER_PORT, default
            7303; 0 is none)
  --peer-host
            the address that port is opened on (env SERVICEMAN_PEER_HOST); by
            default every tailnet address this machine has, and nothing else
  --once    dial once and exit when the link drops, instead of dialling again
  --status  ask the agent running in this folder what it is doing, and print it

The same file is also the root half of a machine, and then it dials nowhere:

  --role root
            listen on a socket for the agent in the person's session and do what
            it asks, as root. Nothing reaches it from another machine: it has no
            link and no port. Kept up by the system's systemd, installed once
            with sudo on that machine.
  --for     who may ask — the socket is given to that person and to nobody else
            (env SERVICEMAN_ROOT_FOR, default $SUDO_USER)
  --root-socket
            where that socket is (env SERVICEMAN_ROOT_SOCKET,
            default /run/serviceman-root.sock). The session agent reads the same
            one, and asks it for the work that has to be root.
`;

main();

async function main()
{
    const argv = process.argv.slice(2);
    if (argv.includes('--help')) {
        console.log(USAGE);
        return;
    }
    if (argv.includes('--status')) {
        // Not an agent this time: the one that is running is asked, and what it says is printed
        process.exitCode = await agent_status_ask();
        return;
    }
    const options = options_from_argv(argv);
    if (options.role === 'root') {
        // The root half answers a socket on this machine and nothing else — no url, no token,
        // nothing to dial
        agent_root_serve(options);
        return;
    }
    const missing = missing_option(options);
    if (missing !== null) {
        console.error(`serviceman-agent: ${missing}\n\n${USAGE}`);
        process.exit(1);
    }
    // What this agent is, before it says anything else — the version and the day it was built
    // are the first questions asked of a program that runs on a machine nobody logs in to
    const boot = log_uid();
    // A group says when it began, even with no parent to name — the first thing it has to say
    // may come long after
    agent_say(boot, 'group_spawn', undefined);
    agent_say(boot, 'agent_begin', {
        agent: AGENT_VERSION,
        built: agent_built,
        node: process.version,
        machine: options.machine,
        url: options.url,
        logs: process.env.SERVICEMAN_LOG_DIR || null,
    });
    // What this agent is doing, on the machine it is doing it on. The file is refreshed as
    // things happen and on a clock besides, so a stale one means the agent itself is stuck.
    const status = {
        agent: AGENT_VERSION,
        built: agent_built,
        pid: process.pid,
        machine: options.machine,
        url: options.url,
        started_at: Date.now(),
        phase: 'dialling',
        remote: null,
        since: Date.now(),
        error: null,
        programs: {},
        // Whether this machine has a root half, asked again whenever the status is
        root: false,
        root_socket: agent_root_socket(options),
    };
    agent_status_serve(status, options);
    // What this machine collects for Logline goes on whether serviceman is there or not: the
    // settings are on its disk, and so are the lines until Logline has them
    agent_logline(options);
    // And so does its door: the table it routes by is on its disk, and the door and the way its
    // peers reach it stand for the life of the agent, not of a link
    agent_doors_state.table = agent_doors_read();
    agent_http_serve(options, boot);
    agent_peer_serve(options, boot);
    // The machine says when it is going, and why. Silence is the one thing a host cannot read:
    // a stop, a shutdown and a network that blinked all look the same from over there.
    watch_leaving(boot);
    agent_sleep_watch(function (reason) {
        agent_say(boot, 'agent_leaving', {reason});
    });
    let wait_ms = FIRST_WAIT_MS;
    for (;;) {
        // One attempt to reach serviceman is one group: every line about this link carries its
        // uid, the way the host writes the other end of the same story
        const group = log_uid();
        agent_say(group, 'group_spawn', undefined);
        let up_at = null;
        try {
            agent_say(group, 'agent_connect_begin', {url: options.url});
            status.phase = 'dialling';
            status.since = Date.now();
            const link = await agent_connect(options);
            wait_ms = FIRST_WAIT_MS;
            up_at = Date.now();
            agent_say(group, 'agent_connect_end_ok', {remote: link.name});
            status.phase = 'online';
            status.remote = link.name;
            status.since = up_at;
            status.error = null;
            await agent_serve(options, link.socket, group, status);
            agent_say(group, 'agent_link_end', {held: format_seconds(Date.now() - up_at)});
            status.phase = 'the link closed';
        }
        catch (error) {
            agent_say(group, (up_at === null ? 'agent_connect_end_error' : 'agent_link_end_error'), {reason: error.message});
            status.phase = 'not connected';
            status.error = error.message;
            // The host says this machine is no longer part of it. Dialling again would be
            // asking the same question forever, so this agent stops — and takes itself off
            // the machine, which is what nobody being left to manage it means.
            if (error.refused === 'removed') {
                const out = await agent_uninstall(options);
                agent_say(group, (out.removed ? 'agent_uninstall_ok' : 'agent_uninstall_refused'), out);
                return;
            }
        }
        status.programs = {};
        if (options.once) {
            return;
        }
        agent_say(group, 'agent_connect_wait', {in: format_seconds(wait_ms)});
        await timers.setTimeout(wait_ms);
        wait_ms = Math.min(wait_ms*2, LONGEST_WAIT_MS);
    }
}

// systemd asks a unit to stop with SIGTERM, and that is what a shutdown looks like from in
// here. The link is told before this process ends, so the host writes down why rather than
// waiting for the silence to run out.
function watch_leaving(group)
{
    for (const signal of ['SIGTERM', 'SIGINT']) {
        process.on(signal, function () {
            agent_say(group, 'agent_leaving', {reason: 'stopping', signal});
            agent_bye('stopping');
            // Long enough for the frame to leave, and no longer: whoever sent the signal is
            // waiting
            setTimeout(function () {
                process.exit(0);
            }, 150);
        });
    }
}

function options_from_argv(argv)
{
    const env = process.env;
    return {
        url: text_after(argv, '--url', env.SERVICEMAN_URL),
        token: text_after(argv, '--token', env.SERVICEMAN_TOKEN),
        machine: text_after(argv, '--machine', env.SERVICEMAN_MACHINE || os.hostname()),
        tags: tags_from_argv(argv, env),
        dir: text_after(argv, '--dir', env.SERVICEMAN_DIR || '/'),
        docker: text_after(argv, '--docker', env.SERVICEMAN_DOCKER || 'docker'),
        apt: text_after(argv, '--apt', env.SERVICEMAN_APT || ''),
        role: text_after(argv, '--role', env.SERVICEMAN_ROLE || ''),
        root_for: text_after(argv, '--for', env.SERVICEMAN_ROOT_FOR || ''),
        root_socket: text_after(argv, '--root-socket', env.SERVICEMAN_ROOT_SOCKET || ''),
        screenshot: text_after(argv, '--screenshot', env.SERVICEMAN_SCREENSHOT || ''),
        http_socket_mode: text_after(argv, '--http-socket-mode', env.SERVICEMAN_HTTP_SOCKET_MODE || ''),
        peer_port: text_after(argv, '--peer-port', env.SERVICEMAN_PEER_PORT || ''),
        peer_host: text_after(argv, '--peer-host', env.SERVICEMAN_PEER_HOST || ''),
        once: argv.includes('--once'),
    };
}

// Every --tag on the line, and SERVICEMAN_TAGS when there is none
function tags_from_argv(argv, env)
{
    const out = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--tag' && i + 1 < argv.length) {
            out.push(argv[i + 1]);
        }
    }
    if (out.length === 0) {
        return String(env.SERVICEMAN_TAGS || '').split(',').map(v => v.trim()).filter(v => v !== '');
    }
    return out;
}

function text_after(argv, name, fallback)
{
    const at = argv.indexOf(name);
    if (at === -1 || at + 1 >= argv.length) {
        return (fallback === undefined ? '' : fallback);
    }
    return argv[at + 1];
}

function missing_option(options)
{
    if (options.url === '') {
        return '--url is required: where serviceman answers';
    }
    if (options.token === '') {
        return '--token is required: the token of this machine, from the serviceman config';
    }
    return null;
}


};
modules["agent/src/agent_built"] = function (module, exports, require) {
module.exports = process.env.SERVICEMAN_AGENT_BUILT || "2026-09-26T21:10:02.755Z";
};
modules["agent/src/agent_bye"] = function (module, exports, require) {
const agent_link = require('agent/src/agent_link');
const link_send_message = require('helpers/link_send_message');

// The machine says it is going, and why, before it goes. A host that is told does not have to
// work it out from silence — and silence is the one thing it cannot tell apart from a network
// that blinked. Said on the way to a shutdown, a stop, and a suspend.
function agent_bye(reason)
{
    const socket = agent_link();
    if (socket === null || socket === undefined || socket.destroyed) {
        return false;
    }
    try {
        link_send_message(socket, {type: 'bye', reason});
        // The link goes with it: a machine that has said goodbye and then sits there open is a
        // machine the host has to wait out anyway
        socket.end();
        return true;
    }
    catch {
        return false;
    }
}

module.exports = agent_bye;

};
modules["agent/src/agent_link"] = function (module, exports, require) {
// The link this agent is talking on, while it has one. Everything the agent says goes to its
// own log and — when there is a link — to the host as well, so what happens on this machine is
// readable on the page that asked for it. A machine with no link keeps writing its own file.
const held = {socket: null};

function agent_link(socket)
{
    if (socket !== undefined) {
        held.socket = socket;
    }
    return held.socket;
}

module.exports = agent_link;

};
modules["helpers/link_send_message"] = function (module, exports, require) {
const link_send = require('helpers/link_send');

// Everything both ends say to each other, apart from the bytes of a blast
function link_send_message(socket, message)
{
    return link_send(socket, 'm', Buffer.from(JSON.stringify(message)));
}

module.exports = link_send_message;

};
modules["helpers/link_send"] = function (module, exports, require) {
const HEADER_BYTES = 5;

// One frame on a remote link: four bytes of length, one byte of kind, then the body.
// The kind is a letter — 'm' for a JSON message, 'b' for a blast of filler, and the
// letters of a tunnelled stream: 'o' open, 'd' data, 'e' end, 'x' gone, 'r' room for more.
// The body may be given in pieces, so a stream frame carries its bytes without a copy.
function link_send(socket, kind, body)
{
    const parts = (Array.isArray(body) ? body : [body]);
    let length = 0;
    for (const part of parts) {
        length += part.length;
    }
    const head = Buffer.allocUnsafe(HEADER_BYTES);
    head.writeUInt32BE(length, 0);
    head.writeUInt8(kind.charCodeAt(0), 4);
    let out = socket.write(head);
    for (const part of parts) {
        out = socket.write(part);
    }
    return out;
}

module.exports = link_send;

};
modules["agent/src/agent_connect"] = function (module, exports, require) {
const http = require('http');
const https = require('https');

const KEEPALIVE_MS = 30000;
const LINK_PATH = '/api/v1/remote';

// One knock on the serviceman door. It answers 101 and the socket becomes the link, or it
// answers with the reason it will not.
//
// The token is the whole introduction: serviceman looks up the remote that holds it and says
// which one it was in the answer, so this end knows the name it was given without being told.
//
// The door is a host and a port, or a socket file — `unix:///run/serviceman.sock`. A socket file
// is what an ssh forward hands you, so an agent can reach a serviceman that listens on nothing.
function agent_connect(options)
{
    return new Promise(function (resolve, reject) {
        const url = new URL(options.url);
        const carrier = (url.protocol === 'https:' ? https : http);
        const req = carrier.request(Object.assign(where(url), {
            path: `${url.protocol === 'unix:' ? '' : url.pathname.replace(/\/+$/, '')}${LINK_PATH}`,
            headers: {
                host: (url.protocol === 'unix:' ? 'localhost' : url.host),
                connection: 'Upgrade',
                upgrade: 'serviceman',
                authorization: `Bearer ${options.token}`,
                // Only a machine adding itself with the join token is asked who it is and what
                // it can do; a machine that holds its own token is already written down
                'serviceman-machine': options.machine,
                'serviceman-tags': options.tags.join(','),
            },
        }));
        req.on('upgrade', function (res, socket, head) {
            if (head.length > 0) {
                socket.unshift(head);
            }
            socket.setNoDelay(true);
            if (url.protocol !== 'unix:') {
                // A socket file has no connection to keep alive; the file is either there or gone
                socket.setKeepAlive(true, KEEPALIVE_MS);
            }
            resolve({socket, name: res.headers['serviceman-remote'] || '?'});
        });
        req.on('response', function (res) {
            const chunks = [];
            res.on('data', function (chunk) {
                chunks.push(chunk);
            });
            res.on('end', function () {
                const out = new Error(`${options.url} refused the link: ${res.statusCode} ${Buffer.concat(chunks).toString('utf8').trim()}`);
                // A refusal the agent is meant to act on rather than wait out. Only this one
                // word does anything: every other refusal is dialled again, because a host
                // that is confused today may be right tomorrow.
                out.refused = String(res.headers['serviceman-refused'] || '');
                reject(out);
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// Where to knock: a socket file, or a host and a port
function where(url)
{
    if (url.protocol === 'unix:') {
        return {socketPath: decodeURIComponent(url.pathname)};
    }
    return {protocol: url.protocol, hostname: url.hostname, port: url.port};
}

module.exports = agent_connect;

};
modules["agent/src/agent_doors_read"] = function (module, exports, require) {
const agent_doors_path = require('agent/src/agent_doors_path');
const fs = require('fs');

// The door table this machine was last told, or null when it was never told one. It is read
// at start, so a machine that comes up while serviceman is away serves what it served before.
function agent_doors_read()
{
    try {
        return JSON.parse(fs.readFileSync(agent_doors_path(), 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

module.exports = agent_doors_read;

};
modules["agent/src/agent_doors_path"] = function (module, exports, require) {
const agent_dir = require('agent/src/agent_dir');
const path = require('path');

// Where the agent keeps its door table: a folder of its own, beside Logline's
function agent_doors_path()
{
    return path.join(agent_dir(), 'doors', 'table.json');
}

module.exports = agent_doors_path;

};
modules["agent/src/agent_dir"] = function (module, exports, require) {
const fs = require('fs');
const path = require('path');

// The folder the agent lives in: its logs, and the services it was asked to install. The
// installer writes it down; a hand-run agent takes the folder its own file sits in —
// `node src/agent` names the folder itself, `node serviceman-agent.js` names a file in it.
function agent_dir()
{
    if (process.env.SERVICEMAN_AGENT_DIR) {
        return path.resolve(process.env.SERVICEMAN_AGENT_DIR);
    }
    const own = path.resolve(process.argv[1] === undefined ? '.' : process.argv[1]);
    if (fs.existsSync(own) && fs.statSync(own).isDirectory()) {
        return own;
    }
    return path.dirname(own);
}

module.exports = agent_dir;

};
modules["agent/src/agent_doors_state"] = function (module, exports, require) {
// What the door routes by, and the link it hands the rest to. One object for the life of the
// agent: the table comes from disk at start and from serviceman when it says so, the link comes
// and goes with serviceman.
//
// table: {version, self, token, names: {host: rule}, services: {name: where}, peers: {machine:
// {addresses, port, token}}}, or null for a machine that was never told any.
// link: the state of the link that is up now, or null.
// seen: when each service of this machine last had a request from a door, {name: ms} — told to
// serviceman with the numbers, so a service in use is not stopped as idle.
const agent_doors_state = {table: null, link: null, seen: {}};

module.exports = agent_doors_state;

};
modules["agent/src/agent_http_serve"] = function (module, exports, require) {
const agent_dir = require('agent/src/agent_dir');
const agent_door_answer = require('agent/src/agent_door_answer');
const agent_doors_state = require('agent/src/agent_doors_state');
const agent_say = require('agent/src/agent_say');
const agent_tunnel = require('agent/src/agent_tunnel');
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
        const said = (options === undefined ? '' : options.http_socket_mode);
        if (said !== undefined && said !== '') {
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
    const said = (options === undefined ? '' : options.http_socket_mode);
    if (said === undefined || said === '') {
        return null;
    }
    const out = parseInt(said, 8);
    return (Number.isNaN(out) ? null : out);
}

module.exports = agent_http_serve;

};
modules["agent/src/agent_door_answer"] = function (module, exports, require) {
const agent_door_proxy = require('agent/src/agent_door_proxy');
const agent_door_rule = require('agent/src/agent_door_rule');
const agent_door_upgrade = require('agent/src/agent_door_upgrade');
const agent_doors_state = require('agent/src/agent_doors_state');
const agent_http_error = require('agent/src/agent_http_error');
const agent_say = require('agent/src/agent_say');
const agent_service_target = require('agent/src/agent_service_target');
const agent_wall_ask = require('agent/src/agent_wall_ask');
const http = require('http');
const log_uid = require('helpers/log_uid');

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
    const at = Date.now();
    const host = host_of(req);
    agent_say(group, 'group_spawn', undefined);
    agent_say(group, 'door_request_begin', {method: req.method, host, path: path_of(req.url)});
    res.once('close', function () {
        agent_say(group, 'door_request_end', {status: (res.writableEnded ? res.statusCode : 'cut_off'), took: `${((Date.now() - at)/1000).toFixed(3)}s`});
    });
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
    const own = (rule.wall !== null && agent_wall_ask.own(req.url));
    const name = (own ? rule.wall : rule.service);
    if (rule.wall !== null && own === false) {
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
    return (mark === -1 ? url : url.slice(0, mark));
}

module.exports = agent_door_answer;

};
modules["agent/src/agent_door_proxy"] = function (module, exports, require) {
const agent_http_error = require('agent/src/agent_http_error');
const http = require('http');

// Headers that are about one connection and not the request: never carried to the next one
const HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade'];

// The request carried on to where it is answered, and the answer back as it came, Set-Cookie
// lines and all. `target` is {host, port} or {socket}; `extra` is headers set on the way.
// Answers false when the far end could not be reached, so the caller can forget the address.
function agent_door_proxy(req, res, target, extra)
{
    return new Promise(function (resolve) {
        const headers = headers_of(req.headers, extra);
        const where = (target.socket === undefined ? {host: target.host, port: target.port} : {socketPath: target.socket});
        const out = http.request(Object.assign(where, {method: req.method, path: req.url, headers, agent: false}), function (answer) {
            const raw = [];
            for (let i = 0; i < answer.rawHeaders.length; i += 2) {
                if (HOP.includes(answer.rawHeaders[i].toLowerCase()) === false) {
                    raw.push(answer.rawHeaders[i], answer.rawHeaders[i + 1]);
                }
            }
            res.writeHead(answer.statusCode, answer.statusMessage, raw);
            answer.pipe(res);
            answer.on('end', function () {
                resolve(true);
            });
        });
        out.on('error', function () {
            if (res.headersSent) {
                res.destroy();
            }
            else {
                agent_http_error(res, 502);
            }
            resolve(false);
        });
        req.pipe(out);
    });
}

function headers_of(given, extra)
{
    const out = {};
    for (const name of Object.keys(given)) {
        if (HOP.includes(name) === false) {
            out[name] = given[name];
        }
    }
    return Object.assign(out, extra);
}

agent_door_proxy.headers_of = headers_of;

module.exports = agent_door_proxy;

};
modules["agent/src/agent_http_error"] = function (module, exports, require) {
const http = require('http');

// An error a visitor sees: the standard status and its standard words, and nothing about why —
// which machine, which service, what is switched off is written to this machine's log, not to
// whoever knocked
function agent_http_error(res, status)
{
    res.writeHead(status, {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'});
    res.end(`${status} ${http.STATUS_CODES[status]}\n`);
}

module.exports = agent_http_error;

};
modules["agent/src/agent_door_rule"] = function (module, exports, require) {
// What the door does with this name: {service, wall, off}, or null for a name it was never
// given. `*.example.com` is every name under it and not the bare name itself; an exact name is
// read before any wildcard that would carry it.
function agent_door_rule(table, host)
{
    if (table === null) {
        return null;
    }
    const names = table.names;
    if (names[host] !== undefined) {
        return names[host];
    }
    for (const pattern of Object.keys(names)) {
        if (pattern.startsWith('*.') && host.length > pattern.length - 1 && host.endsWith(pattern.slice(1))) {
            return names[pattern];
        }
    }
    return null;
}

module.exports = agent_door_rule;

};
modules["agent/src/agent_door_upgrade"] = function (module, exports, require) {
const net = require('net');

// A connection that asks to become something else — a websocket — carried on as bytes both
// ways once the far end is reached. `extra` is headers set on the way.
function agent_door_upgrade(req, socket, head, target, extra)
{
    const where = (target.socket === undefined ? {host: target.host, port: target.port} : {path: target.socket});
    const far = net.connect(where);
    far.once('connect', function () {
        const lines = [`${req.method} ${req.url} HTTP/1.1`];
        const headers = Object.assign({}, req.headers, extra);
        for (const name of Object.keys(headers)) {
            lines.push(`${name}: ${headers[name]}`);
        }
        far.write(`${lines.join('\r\n')}\r\n\r\n`);
        if (head.length > 0) {
            far.write(head);
        }
        far.pipe(socket);
        socket.pipe(far);
    });
    far.on('error', function () {
        socket.destroy();
    });
    socket.on('error', function () {
        far.destroy();
    });
}

module.exports = agent_door_upgrade;

};
modules["agent/src/agent_say"] = function (module, exports, require) {
const agent_link = require('agent/src/agent_link');
const agent_log = require('agent/src/agent_log');
const link_send_message = require('helpers/link_send_message');
const log_words = require('helpers/log_words');

// One line, in the shape every serviceman line has: `[time][group][sender] details`. The group
// is the attempt this line belongs to, so one dial-in reads as one story on both ends.
//
// It goes four ways: to stdout, to the daily file beside the agent, up the link to the host —
// the machine that asked for the work is the one that wants to watch it happen — and to
// whatever takes the agent's own lines for Logline, when something does.
function agent_say(group, sender, details, service)
{
    // Free text when the caller writes it itself — a line a command printed is already a line,
    // and nothing is gained by wrapping it in a key
    const words = (typeof details === 'string' ? details : log_words(details));
    const time = new Date().toISOString();
    const tail = `[${group}][${sender}]${words === '' ? '' : ` ${words}`}`;
    const line = `[${time}]${tail}`;
    console.log(line);
    agent_log(line);
    told(group, sender, details, service);
    if (sink.fn !== null) {
        sink.fn(time, tail);
    }
}

// Where the agent's own lines go besides: set by collection, so this file needs nothing of it
const sink = {fn: null};

agent_say.sink_set = function (fn) {
    sink.fn = fn;
};

function told(group, sender, details, service)
{
    const socket = agent_link();
    if (socket === null || socket.destroyed) {
        return;
    }
    try {
        // The service travels beside the line, not inside it: the host needs it for the page
        // somebody is waiting on, and a reader needs the line as the command wrote it
        link_send_message(socket, {type: 'log', group, sender, words: (details === undefined ? {} : details), service});
    }
    catch {
        // The link went while this was being written. The line is already in this machine's
        // own log, which is the copy that matters here.
    }
}

module.exports = agent_say;

};
modules["agent/src/agent_log"] = function (module, exports, require) {
const fs = require('fs');
const path = require('path');

// The agent says everything on stdout, and writes it to a file as well when it is told where.
// The installer says `SERVICEMAN_LOG_DIR=<prefix>/logs`, so a machine kept up by systemd keeps
// yesterday's lines too. One file a day, named for the day, the same as the host's.
//
// A folder that cannot be written stops the file log. It never stops the agent.
const file_log = {
    dir: process.env.SERVICEMAN_LOG_DIR || '',
    day: null,
    stream: null,
    dead: false,
};

function agent_log(line)
{
    if (file_log.dir === '' || file_log.dir === 'none' || file_log.dead) {
        return;
    }
    const now = new Date();
    const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    if (day !== file_log.day) {
        if (file_log.stream !== null) {
            file_log.stream.end();
        }
        try {
            fs.mkdirSync(file_log.dir, {recursive: true});
            file_log.stream = fs.createWriteStream(path.join(file_log.dir, `${day}.log`), {flags: 'a'});
        }
        catch (error) {
            file_log.dead = true;
            console.error(`serviceman-agent: the log folder cannot be used — ${error.message}`);
            return;
        }
        file_log.stream.on('error', function (error) {
            file_log.dead = true;
            console.error(`serviceman-agent: the log file cannot be written — ${error.message}`);
        });
        file_log.day = day;
    }
    file_log.stream.write(`${line}\n`);
}

module.exports = agent_log;

};
modules["helpers/log_words"] = function (module, exports, require) {
// The details after the sender: `key=value`, one space between pairs.
//
// A value is written bare when it is a printable ASCII word that cannot be mistaken for
// anything else — no space, no double quote, no backslash, no square bracket — so what stands
// in the file is exactly the bytes that were sent: it cannot span two words, break the line, or
// mint a tag of its own. Everything else is JSON, which escapes what would break the shape and
// keeps an empty value visible as "".
function log_words(words)
{
    if (words === undefined) {
        return '';
    }
    const out = [];
    for (const name of Object.keys(words)) {
        const value = words[name];
        // A key with nothing behind it says nothing; it is left out rather than written as null
        if (value === undefined || value === null) {
            continue;
        }
        out.push(`${name}=${log_value(value)}`);
    }
    return out.join(' ');
}

const BARE = /^[\x21-\x7e]+$/;
const UNSAFE = /["\\[\]]/;

function log_value(value)
{
    if (typeof value === 'string') {
        return (BARE.test(value) && UNSAFE.test(value) === false ? value : JSON.stringify(value));
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    // Arrays, objects, booleans and everything else go as compact JSON, so their shape survives
    return JSON.stringify(value);
}

module.exports = log_words;

};
modules["agent/src/agent_service_target"] = function (module, exports, require) {
const agent_doors_state = require('agent/src/agent_doors_state');
const agent_shell = require('agent/src/agent_shell');
const http = require('http');
const link_send_message = require('helpers/link_send_message');
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
    const where = (table === null ? undefined : table.services[name]);
    if (where === undefined || where.machine === null) {
        return null;
    }
    if (where.machine !== table.self) {
        const peer = table.peers[where.machine];
        if (peer === undefined || peer.addresses.length === 0) {
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
    if (kept !== undefined && Date.now() - kept.at < KNOWN_MS) {
        return kept.target;
    }
    let target = await docker_port(where, options);
    if (target === null) {
        const running = await agent_shell([options.docker, 'inspect', '--format', '{{.State.Running}}', where.container]);
        if (running.ok === false || running.stdout === 'true') {
            return null;
        }
        const started = await agent_shell([options.docker, 'start', where.container]);
        if (started.ok === false) {
            return null;
        }
        target = await docker_port(where, options);
        if (target === null || await answers(target, WAKE_MS) === false) {
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
    if (said.ok === false || said.stdout === '') {
        return null;
    }
    const line = said.stdout.split('\n')[0].trim();
    const at = line.lastIndexOf(':');
    const host = line.slice(0, at).replace(/^\[|\]$/g, '');
    const port = parseInt(line.slice(at + 1), 10);
    if (Number.isNaN(port)) {
        return null;
    }
    return {host: (host === '0.0.0.0' || host === '::' || host === '' ? '127.0.0.1' : host), port};
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

};
modules["agent/src/agent_shell"] = function (module, exports, require) {
const child_process = require('child_process');

const MAX_OUTPUT = 4*1024*1024;

// The agent runs on a bare machine, so it asks node for nothing but child_process:
// a failed command is a value here, not an exception
function agent_shell(argv, options)
{
    return new Promise(function (resolve) {
        child_process.execFile(argv[0], argv.slice(1), Object.assign({maxBuffer: MAX_OUTPUT}, options), function (error, stdout, stderr) {
            resolve({
                ok: (error === null),
                // What it ended with, for the times a command fails quietly: a status is the
                // only thing a program that says nothing still says
                code: (error === null ? 0 : (typeof error.code === 'number' ? error.code : -1)),
                // Whether it was stopped rather than finished — a command given a deadline and
                // still going is a different answer from one that failed
                killed: (error !== null && error.killed === true),
                stdout: String(stdout).trim(),
                stderr: (error === null ? String(stderr).trim() : String(stderr || error.message).trim()),
            });
        });
    });
}

module.exports = agent_shell;

};
modules["agent/src/agent_wall_ask"] = function (module, exports, require) {
const http = require('http');

// authwall's own door for this: the door asks, the wall answers, and nothing is carried
// through it at all
const SIDECAR_PATH = '/auth/sidecar';
// A wall that does not answer in this is a wall that is not answering
const ASK_MS = 10000;

// Whether the wall lets this request through: {said: 'yes', user}, {said: 'no'}, or
// {said: 'unreachable'} for a wall that could not be asked — which is never a yes. 200 is a yes
// and says who the visitor is; 401 and 403 are a no; anything else is a wall that did not
// answer the question.
function agent_wall_ask(target, req, host, extra)
{
    return new Promise(function (resolve) {
        const headers = Object.assign({
            host,
            cookie: (req.headers.cookie === undefined ? '' : req.headers.cookie),
            'x-real-ip': client_of(req),
            'x-original-uri': `${scheme_of(req)}://${host}${req.url}`,
            'x-original-method': req.method,
            'content-length': '0',
        }, extra);
        const asking = http.request({host: target.host, port: target.port, method: 'GET', path: SIDECAR_PATH, headers, agent: false}, function (answer) {
            answer.resume();
            if (answer.statusCode === 200) {
                resolve({said: 'yes', user: String(answer.headers['x-auth-user'] || '')});
                return;
            }
            resolve({said: ([401, 403].includes(answer.statusCode) ? 'no' : 'unreachable')});
        });
        asking.setTimeout(ASK_MS, function () {
            asking.destroy(new Error('the wall did not answer in time'));
        });
        asking.on('error', function () {
            resolve({said: 'unreachable'});
        });
        asking.end();
    });
}

agent_wall_ask.sign_in = function (req) {
    return `/auth/sign-in?return=${encodeURIComponent(req.url)}`;
};

// Whether this is the wall's own business: its sign-in page, its callbacks, whatever else it
// keeps under /auth
agent_wall_ask.own = function (url) {
    const mark = url.indexOf('?');
    const pathname = (mark === -1 ? url : url.slice(0, mark));
    return pathname === '/auth' || pathname.startsWith('/auth/');
};

// Who is asking, as the server in front wrote it down: this door is a file, so the socket
// itself says nothing about the visitor
function client_of(req)
{
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded !== '') {
        return forwarded.split(',')[0].trim();
    }
    return String(req.headers['x-real-ip'] || '');
}

function scheme_of(req)
{
    const said = req.headers['x-forwarded-proto'];
    if (typeof said === 'string' && said !== '') {
        return said.split(',')[0].trim();
    }
    return 'http';
}

module.exports = agent_wall_ask;

};
modules["helpers/log_uid"] = function (module, exports, require) {
const crypto = require('crypto');

// A uid is twelve characters: a `c` and eleven letters and digits. The number behind them is
// drawn in two halves, because one draw of 36^11 is larger than crypto.randomInt will give.
//
// A uid is one word to a terminal, so a double click takes all of it, and it can never be read
// as a number. Nothing reads a uid, everything only matches it.
const UID_HALVES = [6, 5];

function log_uid()
{
    let out = 'c';
    for (const letters of UID_HALVES) {
        out += crypto.randomInt(Math.pow(36, letters)).toString(36).padStart(letters, '0');
    }
    return out;
}

module.exports = log_uid;

};
modules["agent/src/agent_tunnel"] = function (module, exports, require) {
const agent_file_get = require('agent/src/agent_file_get');
const agent_file_put = require('agent/src/agent_file_put');
const agent_machine_shell = require('agent/src/agent_machine_shell');
const agent_tar_get = require('agent/src/agent_tar_get');
const link_send_stream = require('helpers/link_send_stream');
const net = require('net');

const WINDOW_BYTES = 256*1024;
const LAST_ID = 0xffffffff;

// The far end of a tunnelled stream: a real socket to something on this machine
function agent_tunnel(state, kind, body)
{
    const id = body.readUInt32BE(0);
    const rest = body.subarray(4);
    if (kind === 'o') {
        stream_open(state, id, JSON.parse(rest.toString('utf8')));
        return;
    }
    const found = state.streams[id];
    if (found === undefined) {
        // A stream this end already dropped; the frames still on the way mean nothing
        return;
    }
    if (kind === 'd') {
        stream_write(state, found, rest);
        return;
    }
    if (kind === 'e') {
        found.socket.end();
        return;
    }
    if (kind === 'r') {
        stream_credit(found, rest.readUInt32BE(0));
        return;
    }
    stream_drop(state, found, null);
}

// The far end is usually a socket; a target that says `shell` is a pty on this machine, and
// one that says `file` is a file being written here. Each of them answers the way a socket
// does, which is the whole of what a tunnelled stream asks of its end.
function stream_open(state, id, target)
{
    let socket;
    try {
        socket = target_socket(target);
    }
    catch (error) {
        // A target this agent cannot open — a kind from a newer host above all — is one dead
        // stream, never a dead link
        link_send_stream(state.link, 'x', id, Buffer.from(JSON.stringify({code: 'EBADTARGET', message: error.message})));
        return;
    }
    stream_attach(state, id, socket);
}

// A socket at this end of a stream, whichever end opened it: its bytes go out as frames, what
// it is sent is written to it, and it says one word when it is over
function stream_attach(state, id, socket)
{
    const found = {id, socket, credit: WINDOW_BYTES, ended: false, gone: false};
    state.streams[id] = found;
    socket.setNoDelay(true);
    socket.on('data', function (chunk) {
        found.credit -= chunk.length;
        const room = link_send_stream(state.link, 'd', id, chunk);
        if (found.credit <= 0 || room === false) {
            socket.pause();
        }
        if (room === false) {
            state.link.once('drain', function () {
                stream_resume(found);
            });
        }
    });
    socket.on('end', function () {
        found.ended = true;
        link_send_stream(state.link, 'e', id);
    });
    socket.on('error', function (error) {
        stream_drop(state, found, error);
    });
    socket.on('close', function () {
        stream_drop(state, found, null);
    });
}

function target_socket(target)
{
    if (target.shell !== undefined) {
        return agent_machine_shell(target.shell);
    }
    if (target.file !== undefined) {
        return agent_file_put(target.file);
    }
    if (target.read !== undefined) {
        return agent_file_get(target.read);
    }
    if (target.tar !== undefined) {
        return agent_tar_get(target.tar);
    }
    if (target.path !== undefined) {
        return net.connect({path: target.path});
    }
    return net.connect({host: (target.host === undefined ? '127.0.0.1' : target.host), port: target.port});
}

function stream_write(state, found, chunk)
{
    if (found.socket.destroyed) {
        return;
    }
    found.socket.write(chunk, function () {
        if (found.gone === false) {
            link_send_stream(state.link, 'r', found.id, bytes_body(chunk.length));
        }
    });
}

function stream_credit(found, bytes)
{
    found.credit += bytes;
    stream_resume(found);
}

function stream_resume(found)
{
    if (found.gone === false && found.credit > 0) {
        found.socket.resume();
    }
}

// Says once that the stream is over, then forgets it
function stream_drop(state, found, error)
{
    if (found.gone) {
        return;
    }
    found.gone = true;
    delete state.streams[found.id];
    link_send_stream(state.link, 'x', found.id, Buffer.from(JSON.stringify(gone_from_error(error))));
    found.socket.destroy();
}

function gone_from_error(error)
{
    if (error === null) {
        return {};
    }
    return {code: (error.code === undefined ? 'ECONNRESET' : error.code), message: error.message};
}

function bytes_body(bytes)
{
    const out = Buffer.allocUnsafe(4);
    out.writeUInt32BE(bytes, 0);
    return out;
}

// A stream this end opens, which is one thing and no more: something knocked at the http
// socket of this machine, and serviceman is being asked to answer it. The numbers are split so
// both ends may open streams on one link — this machine takes the odd ones.
agent_tunnel.open = function (state, socket, target) {
    const id = free_id(state);
    link_send_stream(state.link, 'o', id, Buffer.from(JSON.stringify(target)));
    stream_attach(state, id, socket);
    return id;
};

function free_id(state)
{
    for (;;) {
        state.next_stream_id = (state.next_stream_id + 2 >= LAST_ID ? 1 : state.next_stream_id + 2);
        if (state.streams[state.next_stream_id] === undefined) {
            return state.next_stream_id;
        }
    }
}

module.exports = agent_tunnel;

};
modules["agent/src/agent_file_get"] = function (module, exports, require) {
const EventEmitter = require('events');
const agent_fs_path = require('agent/src/agent_fs_path');
const fs = require('fs');

// A file of this machine the host is reading — the whole of it, or the byte range a player
// asked to seek to. It answers the way a socket does, so the tunnel carries it out without
// knowing the difference — and the tunnel's own credit holds a fast disk back from a slow link.
function agent_file_get(target)
{
    const slice = {};
    if (typeof target.start === 'number') {
        slice.start = target.start;
    }
    if (typeof target.end === 'number') {
        slice.end = target.end;
    }
    const file = fs.createReadStream(agent_fs_path(target.path), slice);
    const out = new EventEmitter();
    out.destroyed = false;
    out.setNoDelay = function () {
    };
    out.write = function () {
    };
    out.end = function () {
    };
    out.pause = function () {
        file.pause();
    };
    out.resume = function () {
        file.resume();
    };
    out.destroy = function () {
        out.destroyed = true;
        file.destroy();
    };
    file.on('data', function (chunk) {
        out.emit('data', chunk);
    });
    file.on('end', function () {
        out.emit('end');
        out.destroyed = true;
        out.emit('close');
    });
    file.on('error', function (error) {
        out.emit('error', error);
    });
    return out;
}

module.exports = agent_file_get;

};
modules["agent/src/agent_fs_path"] = function (module, exports, require) {
const os = require('os');
const path = require('path');

// Where a path the host names is on this machine. ~ is the home of the user the agent runs
// as, and a path written without a root is under it — the reading a person sitting at this
// machine would give it.
function agent_fs_path(text)
{
    const asked = String(text === undefined || text === null || text === '' ? '~' : text);
    if (asked === '~' || asked.startsWith('~/')) {
        return path.join(os.homedir(), asked.slice(1));
    }
    return path.resolve(os.homedir(), asked);
}

module.exports = agent_fs_path;

};
modules["agent/src/agent_file_put"] = function (module, exports, require) {
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

// What a file may land under: a name of its own, and nothing that walks out of the folder
const RE_NAME = /^[^/\\]+$/;

// A file the host is copying onto this machine. It answers the way a socket does, so the
// tunnel carries it without knowing the difference: the bytes come in as they are read over
// there, and the one line it says back is what became of them.
//
// The bytes go to a name of their own until the last of them is in. A copy that stops
// halfway — a link that dropped, a browser that went away — leaves nothing standing where
// the file should be, and never half a file under the name of a whole one.
function agent_file_put(target)
{
    const name = String(target.name === undefined ? '' : target.name);
    if (RE_NAME.test(name) === false || name === '.' || name === '..') {
        throw new Error(`a file lands under a name of its own, and ${JSON.stringify(name)} is not one`);
    }
    const dir = dir_resolved(String(target.dir === undefined ? '~' : target.dir));
    // A folder that is not there is made: the host asks for a place, not for a place that
    // somebody has already been to
    fs.mkdirSync(dir, {recursive: true});
    const full = path.join(dir, name);
    const replaced = fs.existsSync(full);
    // A file that is there is written over as itself: through a link to the file the link
    // points at, and with the permissions it had — an edited script stays runnable
    const written = (replaced ? fs.realpathSync(full) : full);
    const mode = (replaced ? fs.statSync(written).mode & 0o7777 : null);
    const part = path.join(path.dirname(written), `.${path.basename(written)}.part`);
    const file = fs.createWriteStream(part);
    const out = new EventEmitter();
    let bytes = 0;
    out.destroyed = false;
    out.setNoDelay = function () {
    };
    out.write = function (chunk, done) {
        bytes += chunk.length;
        // The write is answered when the bytes are on the disk, and that answer is the credit
        // the host waits for — a slow disk here slows the copy instead of filling this memory
        file.write(chunk, done);
    };
    out.end = function () {
        file.end();
    };
    // Nothing comes back from a file until it is written, so there is nothing to hold back
    out.pause = function () {
    };
    out.resume = function () {
    };
    out.destroy = function () {
        out.destroyed = true;
        file.destroy();
        fs.rmSync(part, {force: true});
    };
    file.on('error', function (error) {
        out.emit('error', error);
    });
    // The last byte is in: the file takes the name it was sent under, and the host hears where
    // it landed
    file.on('finish', function () {
        try {
            if (mode !== null) {
                fs.chmodSync(part, mode);
            }
            fs.renameSync(part, written);
        }
        catch (error) {
            out.emit('error', error);
            return;
        }
        out.emit('data', Buffer.from(`${JSON.stringify({path: full, bytes, replaced})}\n`));
        out.emit('end');
        out.destroyed = true;
        out.emit('close');
    });
    return out;
}

// Where a folder the host names is on this machine. `~` is the home of the user the agent
// runs as, and a folder written without a root is under it — the reading a person sitting at
// this machine would give it.
function dir_resolved(text)
{
    if (text === '~' || text.startsWith('~/')) {
        return path.join(os.homedir(), text.slice(1));
    }
    return path.resolve(os.homedir(), text);
}

module.exports = agent_file_put;

};
modules["agent/src/agent_machine_shell"] = function (module, exports, require) {
const EventEmitter = require('events');
const child_process = require('child_process');
const os = require('os');

// Node alone cannot open a pty, and a terminal without one is not a terminal — no prompt
// colors, no vim, no ctrl-c. Every machine this runs on has python3, whose pty module forks
// the shell under a real one. Fd 3 carries the resizes, because the bytes on stdin are the
// person typing and nothing else.
const PTY_PY = `
import fcntl, os, pty, select, struct, sys, termios

def resize(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[3], sys.argv[3:])
resize(fd, int(sys.argv[1]), int(sys.argv[2]))
while True:
    try:
        ready, _, _ = select.select([0, fd, 3], [], [])
    except OSError:
        break
    if 0 in ready:
        data = os.read(0, 65536)
        if not data:
            break
        os.write(fd, data)
    if 3 in ready:
        lines = os.read(3, 256).decode('utf8', 'replace').split()
        if len(lines) >= 2:
            resize(fd, int(lines[-2]), int(lines[-1]))
    if fd in ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        os.write(1, data)
os.close(fd)
`;

// A terminal on this machine, as the user the agent runs as. It answers like the socket a
// tunnelled stream usually is, so the tunnel carries it without knowing the difference.
function agent_machine_shell(target)
{
    const shell = process.env.SHELL || '/bin/bash';
    const child = child_process.spawn('python3', ['-c', PTY_PY, String(target.cols || 80), String(target.rows || 24), shell, '-l'], {
        cwd: os.homedir(),
        env: Object.assign({}, process.env, {TERM: 'xterm-256color'}),
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    const out = new EventEmitter();
    out.destroyed = false;
    out.setNoDelay = function () {
    };
    out.write = function (chunk, done) {
        child.stdin.write(chunk, done);
    };
    out.end = function () {
        child.stdin.end();
    };
    out.pause = function () {
        child.stdout.pause();
    };
    out.resume = function () {
        child.stdout.resume();
    };
    out.destroy = function () {
        out.destroyed = true;
        child.kill('SIGKILL');
    };
    out.resize = function (cols, rows) {
        if (child.stdio[3] !== null && child.stdio[3].destroyed === false) {
            child.stdio[3].write(`${cols} ${rows}\n`);
        }
    };
    child.stdout.on('data', function (chunk) {
        out.emit('data', chunk);
    });
    // What python itself says — a missing python3 says nothing here, spawn errors below do,
    // but a traceback belongs on the screen of whoever opened the shell
    child.stderr.on('data', function (chunk) {
        out.emit('data', chunk);
    });
    child.stdout.on('end', function () {
        out.emit('end');
    });
    child.on('error', function (error) {
        out.emit('error', error);
    });
    child.on('close', function () {
        out.destroyed = true;
        out.emit('close');
    });
    child.stdin.on('error', function () {
        // The shell went while input was on the way; close says the rest
    });
    return out;
}

module.exports = agent_machine_shell;

};
modules["agent/src/agent_tar_get"] = function (module, exports, require) {
const EventEmitter = require('events');
const agent_fs_path = require('agent/src/agent_fs_path');
const {spawn} = require('child_process');

// What a chosen name may be: a name of the folder itself, nothing that walks out of it
const RE_NAME = /^[^/\\]+$/;

// Several names of one folder, answered as one tar the machine writes on the way out. tar
// itself walks what it is given, so a chosen folder comes whole.
function agent_tar_get(target)
{
    const names = (Array.isArray(target.names) ? target.names.map(String) : []);
    if (names.length === 0) {
        throw new Error('nothing is named to take');
    }
    for (const name of names) {
        if (RE_NAME.test(name) === false || name === '.' || name === '..') {
            throw new Error(`a name of the folder itself is wanted, and ${JSON.stringify(name)} is not one`);
        }
    }
    const child = spawn('tar', ['-cf', '-', '-C', agent_fs_path(target.dir)].concat(names));
    const said = [];
    const out = new EventEmitter();
    out.destroyed = false;
    out.setNoDelay = function () {
    };
    out.write = function () {
    };
    out.end = function () {
    };
    out.pause = function () {
        child.stdout.pause();
    };
    out.resume = function () {
        child.stdout.resume();
    };
    out.destroy = function () {
        out.destroyed = true;
        child.kill('SIGKILL');
    };
    child.stdout.on('data', function (chunk) {
        out.emit('data', chunk);
    });
    child.stderr.on('data', function (chunk) {
        said.push(chunk);
    });
    child.on('error', function (error) {
        out.emit('error', error);
    });
    child.on('close', function (code) {
        if (out.destroyed) {
            return;
        }
        if (code !== 0) {
            const lines = Buffer.concat(said).toString('utf8').trim().split('\n');
            out.emit('error', new Error(lines[lines.length - 1] || `tar ended with ${code}`));
            return;
        }
        out.emit('end');
        out.destroyed = true;
        out.emit('close');
    });
    return out;
}

module.exports = agent_tar_get;

};
modules["helpers/link_send_stream"] = function (module, exports, require) {
const link_send = require('helpers/link_send');

const EMPTY = Buffer.alloc(0);

// A frame that belongs to one stream inside the link: its number leads the body
function link_send_stream(socket, kind, id, body)
{
    const head = Buffer.allocUnsafe(4);
    head.writeUInt32BE(id, 0);
    return link_send(socket, kind, [head, (body === undefined ? EMPTY : body)]);
}

module.exports = link_send_stream;

};
modules["agent/src/agent_logline"] = function (module, exports, require) {
const agent_docker_socket = require('agent/src/agent_docker_socket');
const agent_logline_path = require('agent/src/agent_logline_path');
const agent_logline_read = require('agent/src/agent_logline_read');
const agent_say = require('agent/src/agent_say');
const fs = require('fs');
const log_uid = require('helpers/log_uid');
const logline_collect = require('agent/src/logline_collect');
const logline_files = require('agent/src/logline_files');
const logline_ship = require('agent/src/logline_ship');
const logline_spool = require('agent/src/logline_spool');
const time_utc_nanos = require('agent/src/time_utc_nanos');

// How much of the disk the spool may take while Logline cannot be reached: a gigabyte, or a
// tenth of the disk it is on, whichever is less. At that the machine stops reading, and docker
// holds its lines until there is room.
const CAP_BYTES = 1024*1024*1024;
const CAP_SHARE = 0.1;

// Collection on this machine, as its settings say it should be: running from the floor when
// logs are "all", stopped when they are not. Asked when the agent starts — so a machine whose
// serviceman is away collects all the same — and every time serviceman says something new.
// What is in the spool stays through an off, and goes when collection is on again.
const state = {collect: null, files: null, dirs: null, ship: null, spool: null, floor: null, stats: null, group: null, queue: Promise.resolve(), host: null, early: [], decided: false, flush_asked: false};

// The agent's own lines are the machine's too: every one goes into the spool while collection
// runs, as `[group][sender] details` with its time beside, labelled service=serviceman-agent.
// What it says before collection has started — agent_begin after a restart, the first dial —
// waits here, and goes in once it has; a machine switched off lets it go.
const EARLY_LINES = 1000;
const OWN_SERVICE = 'serviceman-agent';

agent_say.sink_set(function (time, tail) {
    if (state.collect !== null) {
        own_keep(time, tail);
        return;
    }
    if (state.decided === false && state.early.length < EARLY_LINES) {
        state.early.push({time, tail});
    }
});

function agent_logline(options)
{
    state.queue = state.queue.then(() => apply(options)).catch(function (error) {
        agent_say(state.group || log_uid(), 'logline_collect_error', {reason: error.message});
    });
    return state.queue;
}

async function apply(options)
{
    state.host = options.machine;
    const settings = agent_logline_read();
    if (settings.logs !== 'all' || settings.floor === null) {
        stop('switched off');
        state.decided = true;
        state.early = [];
        return;
    }
    const floor = time_utc_nanos(settings.floor);
    if (state.collect !== null && state.floor === floor) {
        // The same collection; a new endpoint or token is read by the next send, and a new
        // list of folders is watched from now
        if (JSON.stringify(settings.dirs) !== state.dirs) {
            files_start(options, settings);
        }
        state.ship.wake();
        return;
    }
    stop('switched on again');
    const dir = agent_logline_path('spool');
    if (state.spool === null) {
        state.spool = logline_spool(dir, {
            cap_bytes: cap_bytes(dir),
            on_data: function () {
                if (state.ship !== null) {
                    state.ship.wake();
                }
            },
        });
        state.stats = stats_read(dir);
    }
    state.group = log_uid();
    const socket = await agent_docker_socket(options);
    state.floor = floor;
    state.collect = logline_collect({socket, spool: state.spool, floor, host: options.machine, say});
    files_start(options, settings);
    for (const item of state.early) {
        own_keep(item.time, item.tail);
    }
    state.early = [];
    state.decided = true;
    state.ship = logline_ship({spool: state.spool, dir, settings: agent_logline_read, stats: state.stats, say});
    say('logline_collect_begin', {floor: settings.floor, docker: socket, cap: state.spool.stats().cap_bytes, endpoint: settings.endpoint, dirs: settings.dirs.map(v => v.path)});
}

// One of the agent's own lines, into the spool. A burst of them is synced once, right after:
// they cannot be read again from anywhere the way a container's can.
function own_keep(time, tail)
{
    state.spool.append({src: 'agent', at: time, time, labels: {host: state.host, service: OWN_SERVICE}, line: tail});
    if (state.flush_asked === false) {
        state.flush_asked = true;
        setImmediate(function () {
            state.flush_asked = false;
            if (state.spool !== null) {
                state.spool.flush();
            }
        });
    }
}

// The folders the settings name, watched afresh
function files_start(options, settings)
{
    if (state.files !== null) {
        state.files.stop();
    }
    state.dirs = JSON.stringify(settings.dirs);
    state.files = logline_files({spool: state.spool, host: options.machine, dirs: settings.dirs, floor: state.floor, say});
}

// A line in the group of this collection
function say(sender, words)
{
    agent_say(state.group, sender, words);
}

function stop(reason)
{
    if (state.collect === null) {
        return;
    }
    state.collect.stop();
    state.files.stop();
    state.ship.stop();
    state.collect = null;
    state.files = null;
    state.dirs = null;
    state.ship = null;
    state.floor = null;
    agent_say(state.group, 'logline_collect_end', {reason});
}

// For the host's Logs tab: whether it collects, and every number its sending moves
agent_logline.status = function () {
    const stats = state.stats;
    const spool = (state.spool === null ? null : state.spool.stats());
    return {
        collecting: state.collect !== null,
        containers: (state.collect === null ? 0 : state.collect.containers()),
        files: (state.files === null ? 0 : state.files.files()),
        // Folders it could not read, and why: a path that is not there, a folder it may not open
        dir_errors: (state.files === null ? {} : state.files.errors()),
        sent: {lines: (stats === null ? 0 : stats.sent_lines), batches: (stats === null ? 0 : stats.sent_batches), bytes: (stats === null ? 0 : stats.sent_bytes)},
        waiting: {lines: (spool === null ? 0 : spool.waiting_lines), bytes: (spool === null ? 0 : spool.waiting_bytes), oldest: (spool === null ? null : spool.oldest_at)},
        last_sent_at: (stats === null ? null : stats.last_sent_at),
        last_answer: (stats === null ? null : stats.last_answer),
    };
};

function cap_bytes(dir)
{
    if (process.env.SERVICEMAN_LOGLINE_CAP) {
        return parseInt(process.env.SERVICEMAN_LOGLINE_CAP, 10);
    }
    try {
        const disk = fs.statfsSync(dir);
        return Math.min(CAP_BYTES, Math.floor(disk.bsize*disk.blocks*CAP_SHARE));
    }
    catch {
        return CAP_BYTES;
    }
}

// What was sent before this process, so the numbers on the page go on from there
function stats_read(dir)
{
    const out = {sent_lines: 0, sent_batches: 0, sent_bytes: 0, last_sent_at: null, last_answer: null, failing: null};
    try {
        return Object.assign(out, JSON.parse(fs.readFileSync(`${dir}/stats.json`, 'utf8')));
    }
    catch {
        return out;
    }
}

module.exports = agent_logline;

};
modules["agent/src/agent_docker_socket"] = function (module, exports, require) {
const agent_shell = require('agent/src/agent_shell');

// Where this machine's docker engine answers. DOCKER_HOST when it names a socket; otherwise
// what the docker command itself uses — a rootless docker or a context lives elsewhere — and
// the usual place when the command does not say.
async function agent_docker_socket(options)
{
    const host = process.env.DOCKER_HOST || '';
    if (host.startsWith('unix://')) {
        return host.slice('unix://'.length);
    }
    const answer = await agent_shell([options.docker, 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
    if (answer.ok && answer.stdout.startsWith('unix://')) {
        return answer.stdout.slice('unix://'.length);
    }
    return '/var/run/docker.sock';
}

module.exports = agent_docker_socket;

};
modules["agent/src/agent_logline_path"] = function (module, exports, require) {
const agent_dir = require('agent/src/agent_dir');
const path = require('path');

// Where the agent keeps what serviceman told it about Logline, and later the lines on their way
// there: a folder of its own, so no volume a service keeps under data/ can ever share a name
function agent_logline_path(name)
{
    return path.join(agent_dir(), 'logline', name);
}

module.exports = agent_logline_path;

};
modules["agent/src/agent_logline_read"] = function (module, exports, require) {
const agent_logline_path = require('agent/src/agent_logline_path');
const fs = require('fs');

// What this machine was last told about Logline — {endpoint, token, logs, floor} — or logs off
// when it was never told anything
function agent_logline_read()
{
    let text;
    try {
        text = fs.readFileSync(agent_logline_path('settings.json'), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return {endpoint: null, token: null, logs: 'off', floor: null, dirs: []};
        }
        throw error;
    }
    // A file from before folders were read names none
    return Object.assign({dirs: []}, JSON.parse(text));
}

module.exports = agent_logline_read;

};
modules["agent/src/logline_collect"] = function (module, exports, require) {
const docker_api = require('agent/src/docker_api');
const logline_follow = require('agent/src/logline_follow');
const timers = require('timers/promises');

// Every container a machine has, followed into the spool — the ones there when collection
// begins, stopped ones among them, and every one started after. Nothing a container wrote
// after the floor is left behind:
//
//   - a container started while the agent was down is in the list it reads first
//   - one that starts later is in docker's events; a list read again every few minutes, and
//     every time the events stream drops, catches whatever the events did not say
//   - one that stops is read to its end, and once more after that
//
// A container labelled logline=off is left alone; Logline's own containers are, so Logline
// does not log itself.
//
// ctx: {socket, spool, floor, host, say} -> {stop, containers}
const RELIST_MS = 5*60*1000;
const EVENTS_WAIT_MS = 1000;

function logline_collect(ctx)
{
    const run = Object.assign({}, ctx, {
        running: true,
        following: new Set(),
        skipped: new Set(),
        streams: new Set(),
        active: () => run.running,
    });
    containers_all(run);
    events_watch(run);
    const timer = setInterval(function () {
        containers_all(run);
    }, RELIST_MS);
    timer.unref();
    return {
        stop: function () {
            run.running = false;
            clearInterval(timer);
            for (const res of run.streams) {
                res.destroy();
            }
        },
        containers: () => run.following.size,
    };
}

async function containers_all(run)
{
    let list;
    try {
        list = await docker_api.json(run.socket, '/containers/json?all=1');
    }
    catch (error) {
        run.say('logline_docker_error', {reason: error.message, then: 'read again within five minutes'});
        return;
    }
    for (const item of list) {
        container_consider(run, item.Id);
    }
}

// docker's word as containers start, for as long as collection runs
async function events_watch(run)
{
    const filters = encodeURIComponent(JSON.stringify({type: ['container'], event: ['start']}));
    while (run.running) {
        try {
            const res = await docker_api(run.socket, `/events?filters=${filters}`);
            run.streams.add(res);
            let rest = '';
            for await (const chunk of res) {
                rest += chunk.toString('utf8');
                const lines = rest.split('\n');
                rest = lines.pop();
                for (const line of lines) {
                    const event = (line.trim() === '' ? null : JSON.parse(line));
                    if (event !== null && event.id !== undefined) {
                        container_consider(run, event.id);
                    }
                }
            }
            run.streams.delete(res);
        }
        catch (error) {
            if (run.running) {
                run.say('logline_docker_error', {reason: error.message, then: 'listening again'});
            }
        }
        if (run.running === false) {
            return;
        }
        // Whatever started while nobody listened is in the list
        await timers.setTimeout(EVENTS_WAIT_MS);
        await containers_all(run);
    }
}

async function container_consider(run, id)
{
    if (run.running === false || run.following.has(id) || run.skipped.has(id)) {
        return;
    }
    run.following.add(id);
    try {
        for (;;) {
            let found;
            try {
                found = await docker_api.json(run.socket, `/containers/${encodeURIComponent(id)}/json`);
            }
            catch (error) {
                if (error.status === 404) {
                    // Gone before a line of it was read: what it wrote after the floor went with it
                    if (run.spool.cursor(id) === null) {
                        run.say('logline_lost', {container: id.slice(0, 12), reason: 'removed before it was read'});
                    }
                    return;
                }
                throw error;
            }
            const labels = (found.Config === undefined || found.Config.Labels === null ? {} : found.Config.Labels);
            if (labels.logline === 'off') {
                run.skipped.add(id);
                return;
            }
            const container = {
                id: found.Id,
                name: String(found.Name || '').replace(/^\//, ''),
                image: (found.Config === undefined ? '' : found.Config.Image),
                tty: (found.Config !== undefined && found.Config.Tty === true),
                labels,
            };
            const ended = await logline_follow(run, container);
            if (ended === 'gone' || run.running === false) {
                return;
            }
            // Started again while its last run was being read to the end: follow this run too
            const now = await docker_api.json(run.socket, `/containers/${encodeURIComponent(id)}/json`).catch(() => null);
            if (now === null || now.State === undefined || now.State.Running !== true) {
                return;
            }
        }
    }
    catch (error) {
        if (run.running) {
            run.say('logline_follow_error', {container: id.slice(0, 12), reason: error.message, then: 'read again within five minutes'});
        }
    }
    finally {
        run.following.delete(id);
    }
}

module.exports = logline_collect;

};
modules["agent/src/docker_api"] = function (module, exports, require) {
const http = require('http');

// One GET to the docker engine over its socket: the answer as it streams. Reading logs and
// events this way, rather than through the docker command, keeps a container's two streams in
// the one order docker wrote them.
function docker_api(socket, pathname)
{
    return new Promise(function (resolve, reject) {
        const req = http.request({socketPath: socket, path: pathname, method: 'GET', headers: {host: 'docker'}}, resolve);
        req.once('error', reject);
        req.end();
    });
}

// The same, for an answer that is JSON: parsed, or thrown with what docker said
docker_api.json = async function (socket, pathname) {
    const res = await docker_api(socket, pathname);
    const chunks = [];
    for await (const chunk of res) {
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (res.statusCode < 200 || res.statusCode > 299) {
        const error = new Error(`docker ${res.statusCode}: ${text.trim()}`);
        error.status = res.statusCode;
        throw error;
    }
    return JSON.parse(text);
};

module.exports = docker_api;

};
modules["agent/src/logline_follow"] = function (module, exports, require) {
const docker_api = require('agent/src/docker_api');
const docker_log_reader = require('agent/src/docker_log_reader');
const logline_line_cut = require('agent/src/logline_line_cut');
const logline_time_strip = require('agent/src/logline_time_strip');

// One container's output into the spool, from where its reading stood, until the container
// stops — and once more after that, for anything that came in while the stream was closing.
//
// Where it stood is the spool's own word: the latest stamp it holds for this container, and how
// many of its lines share that stamp. Docker is asked for everything since that stamp, the
// stamp itself included, and the lines already held are skipped by count. Before the floor
// nothing is read: the floor is when collection was switched on.
//
// ctx: {socket, spool, floor, host, active}. Answers 'gone' when docker no longer knows it.
async function logline_follow(ctx, container)
{
    for (const follow of [true, false]) {
        const read = await logs_read(ctx, container, follow);
        if (read === 'gone' || ctx.active() === false) {
            return read;
        }
    }
    return 'ended';
}

async function logs_read(ctx, container, follow)
{
    const kept = ctx.spool.cursor(container.id);
    const from = (kept === null || kept.at < ctx.floor ? {at: ctx.floor, n: 0} : kept);
    const query = `follow=${follow ? 1 : 0}&stdout=1&stderr=1&timestamps=1&since=${unix_of(from.at)}`;
    const res = await docker_api(ctx.socket, `/containers/${encodeURIComponent(container.id)}/logs?${query}`);
    if (res.statusCode === 404) {
        res.resume();
        return 'gone';
    }
    if (res.statusCode !== 200) {
        const chunks = [];
        for await (const chunk of res) {
            chunks.push(chunk);
        }
        throw new Error(`docker ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8').trim()}`);
    }
    ctx.streams.add(res);
    try {
        const reader = docker_log_reader(container.tty);
        const state = {skip: from.n, from: from.at, last_at: from.at};
        for await (const chunk of res) {
            for (const item of reader.push(chunk)) {
                // At its cap the spool takes nothing more: the stream is not read, docker
                // holds the lines, and reading goes on where it stopped once there is room
                if (ctx.spool.full()) {
                    await ctx.spool.room();
                }
                if (ctx.active() === false) {
                    return 'stopped';
                }
                line_keep(ctx, container, state, item);
            }
        }
        for (const item of reader.end()) {
            line_keep(ctx, container, state, item);
        }
    }
    finally {
        ctx.streams.delete(res);
    }
    return 'read';
}

function line_keep(ctx, container, state, item)
{
    const at = (item.at === null ? state.last_at : item.at);
    // Already held: before the stamp it resumes from, or one of the lines at that stamp
    if (at < state.from) {
        return;
    }
    if (at === state.from && state.skip > 0) {
        state.skip -= 1;
        return;
    }
    state.last_at = at;
    const stripped = logline_time_strip(item.text.trimEnd());
    ctx.spool.append({
        src: container.id,
        at,
        time: (stripped.time === null ? at : stripped.time),
        labels: labels_of(ctx, container, item.stream),
        line: logline_line_cut(stripped.line),
    });
}

// What the line is about, from what docker knows of the container: compose's own labels where
// compose made it
function labels_of(ctx, container, stream)
{
    const labels = container.labels || {};
    // A container serviceman made says which of its services it is: the name the control page
    // shows, not serviceman-<name>, so a link from that page finds its lines
    const out = {host: ctx.host, service: labels['serviceman.service'] || labels['com.docker.compose.service'] || container.name};
    if (labels['com.docker.compose.project'] !== undefined) {
        out.project = labels['com.docker.compose.project'];
    }
    out.container = container.name;
    out.container_id = container.id.slice(0, 12);
    out.image = container.image;
    out.stream = stream;
    return out;
}

// "2026-09-25T18:17:09.979123456Z" -> "1790360229.979123456", which is how the engine takes
// a moment to the nanosecond
function unix_of(at)
{
    return `${Math.floor(Date.parse(`${at.slice(0, 19)}Z`)/1000)}.${at.slice(20, 29)}`;
}

module.exports = logline_follow;

};
modules["agent/src/docker_log_reader"] = function (module, exports, require) {
const time_utc_nanos = require('agent/src/time_utc_nanos');

const STREAMS = {1: 'stdout', 2: 'stderr'};

// Docker's log stream, as the engine sends it with timestamps=1 -> lines {stream, at, text}, in
// the one order docker wrote them.
//
// A container without a terminal gets both of its streams in one: frames of an 8-byte header —
// which stream, and how long — then the bytes. One with a terminal (docker run -t) has one
// stream and no frames. Every line starts with docker's stamp and a space. A line docker cut —
// it cuts at 16K — comes as pieces, each stamped, and only the last ends in a newline: the
// pieces are one line, at the first piece's time.
function docker_log_reader(tty)
{
    let pending = Buffer.alloc(0);
    const open = {stdout: null, stderr: null};
    return {
        push: function (chunk) {
            pending = Buffer.concat([pending, chunk]);
            const out = [];
            if (tty) {
                const cut = pending.lastIndexOf(10);
                if (cut === -1) {
                    return out;
                }
                piece_read(open, 'stdout', pending.subarray(0, cut + 1).toString('utf8'), out);
                pending = pending.subarray(cut + 1);
                return out;
            }
            while (pending.length >= 8) {
                const size = pending.readUInt32BE(4);
                if (pending.length < 8 + size) {
                    break;
                }
                piece_read(open, STREAMS[pending[0]] || 'stdout', pending.subarray(8, 8 + size).toString('utf8'), out);
                pending = pending.subarray(8 + size);
            }
            return out;
        },
        // What is left when the stream ends: a last line that never got its newline
        end: function () {
            const out = [];
            if (tty && pending.length > 0) {
                piece_read(open, 'stdout', `${pending.toString('utf8')}\n`, out);
            }
            for (const stream of ['stdout', 'stderr']) {
                if (open[stream] !== null) {
                    out.push(open[stream]);
                    open[stream] = null;
                }
            }
            return out;
        },
    };
}

// One frame's worth: stamped pieces, each a whole line when it ends in a newline
function piece_read(open, stream, text, out)
{
    const parts = text.split('\n');
    const last = parts.pop();
    for (const part of parts) {
        piece_add(open, stream, part, true, out);
    }
    if (last !== '') {
        piece_add(open, stream, last, false, out);
    }
}

function piece_add(open, stream, part, whole, out)
{
    const space = part.indexOf(' ');
    const at = (space === -1 ? null : time_utc_nanos(part.slice(0, space)));
    const text = (at === null ? part : part.slice(space + 1));
    if (open[stream] === null) {
        open[stream] = {stream, at, text};
    }
    else {
        open[stream].text += text;
    }
    if (whole) {
        out.push(open[stream]);
        open[stream] = null;
    }
}

module.exports = docker_log_reader;

};
modules["agent/src/time_utc_nanos"] = function (module, exports, require) {
const RE_ISO = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:?\d\d)?$/;

// An ISO time -> the same instant in UTC, nine digits after the second, so two of them compare
// as strings: "2026-09-25T22:17:09.979+03:00" -> "2026-09-25T19:17:09.979000000Z". Docker
// writes its stamps this way, but drops trailing zeros, which would sort ".98Z" after ".979Z".
// A time with no zone is local time here. Not a real time — a 30th of February — is null.
function time_utc_nanos(text)
{
    const found = (typeof text === 'string' ? RE_ISO.exec(text) : null);
    if (found === null) {
        return null;
    }
    const parts = found.slice(1, 7).map(v => parseInt(v, 10));
    const days = new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
    if (parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > days || parts[3] > 23 || parts[4] > 59 || parts[5] > 59) {
        return null;
    }
    const zone = found[8];
    let ms;
    if (zone === undefined) {
        ms = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]).getTime();
    }
    else {
        const sign = (zone === 'Z' ? 0 : (zone[0] === '-' ? -1 : 1));
        const digits = zone.replace(/[^0-9]/g, '');
        const shift = (sign === 0 ? 0 : sign*(parseInt(digits.slice(0, 2), 10)*60 + parseInt(digits.slice(2, 4), 10)));
        ms = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4] - shift, parts[5]);
    }
    return `${new Date(ms).toISOString().slice(0, 19)}.${(found[7] || '').padEnd(9, '0')}Z`;
}

module.exports = time_utc_nanos;

};
modules["agent/src/logline_line_cut"] = function (module, exports, require) {
const LINE_BYTES = 64*1024;

// A line over 64K is cut the rules' way — on a character, never inside one, and ending with
// the bytes left out — so one runaway line cannot outgrow a batch
function logline_line_cut(line)
{
    const bytes = Buffer.from(line);
    if (bytes.length <= LINE_BYTES) {
        return line;
    }
    let end = LINE_BYTES - 32;
    // Back off to the start of a character: continuation bytes are 10xxxxxx
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
        end -= 1;
    }
    return `${bytes.subarray(0, end).toString('utf8')}...+${bytes.length - end}`;
}

module.exports = logline_line_cut;

};
modules["agent/src/logline_time_strip"] = function (module, exports, require) {
const time_utc_nanos = require('agent/src/time_utc_nanos');

// The shapes of a time a line may start with — decided, notes/logline.md D3:
//   2026/09/25 22:47:45 then \s*[        2026-09-25T19:48:10.059Z then \s*[
//   either one wrapped in []
const SLASH = '\\d{4}/\\d\\d/\\d\\d \\d\\d:\\d\\d:\\d\\d(?:\\.\\d{1,9})?';
const ISO = '\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(?:\\.\\d{1,9})?(?:Z|[+-]\\d\\d:?\\d\\d)?';
const RE_BARE = new RegExp(`^(${SLASH}|${ISO})\\s*(?=\\[)`);
const RE_WRAPPED = new RegExp(`^\\[(${SLASH}|${ISO})\\]\\s*`);

// A line that starts with its own time -> that time, and the line without it. The time is the
// line's own; the one the provider stamped is only for a line that has none. A time with no
// zone is local time on this machine. One that is not a real time stays in the line, and the
// answer's time is null.
function logline_time_strip(line)
{
    const found = RE_WRAPPED.exec(line) || RE_BARE.exec(line);
    if (found === null) {
        return {time: null, line};
    }
    const time = time_utc_nanos(found[1].replace(/^(\d{4})\/(\d\d)\/(\d\d) /, '$1-$2-$3T'));
    if (time === null) {
        return {time: null, line};
    }
    return {time, line: line.slice(found[0].length)};
}

module.exports = logline_time_strip;

};
modules["agent/src/logline_files"] = function (module, exports, require) {
const agent_logline_path = require('agent/src/agent_logline_path');
const file_write_synced = require('agent/src/file_write_synced');
const fs = require('fs');
const logline_line_cut = require('agent/src/logline_line_cut');
const logline_time_strip = require('agent/src/logline_time_strip');
const os = require('os');
const path = require('path');

const SCAN_MS = 1000;
const READ_BYTES = 1024*1024;
// What is not a log to read line by line: compressed, or rotated away and packed up
const RE_SKIPPED = /\.(gz|xz|bz2|zst|zip|lz4|7z)$/i;

// The files of some folders, into the spool, a line at a time as they are written. A folder is
// a path — every file in it — or a path whose last part is a pattern, /var/log/nginx/*.log.
//
// A file is known by what the disk calls it, device and inode, not by its name: a file
// renamed by logrotate is the same file, and a new one under the old name is a new one. Where
// its reading stood is the spool's own word — the byte offset after its last line held — so a
// restart goes on from there. A file shorter than that was truncated in place: it is read
// again from its start, its lines under a key of their own.
//
// Nothing from before the floor: a file already there when its folder is first watched is read
// from where it ends at that moment, and one that appears after is read from its start. Which
// files were there is kept in files.json, so a restart does not take a file that arrived while
// the agent was away for one that was always there.
//
// ctx: {spool, host, dirs, floor, say} -> {stop, files, errors}
function logline_files(ctx)
{
    const run = {running: true, timer: null, seen: seen_read(ctx.floor), files: 0, errors: {}};
    function tick() {
        if (run.running === false) {
            return;
        }
        try {
            scan(ctx, run);
        }
        catch (error) {
            ctx.say('logline_files_error', {reason: error.message, then: 'read again in a second'});
        }
        run.timer = setTimeout(tick, SCAN_MS);
        run.timer.unref();
    }
    tick();
    return {
        stop: function () {
            run.running = false;
            clearTimeout(run.timer);
        },
        files: () => run.files,
        errors: () => run.errors,
    };
}

function scan(ctx, run)
{
    let count = 0;
    let changed = false;
    for (const dir of ctx.dirs) {
        let found;
        try {
            found = files_of(dir.path);
            delete run.errors[dir.path];
        }
        catch (error) {
            if (run.errors[dir.path] !== error.message) {
                ctx.say('logline_dir_error', {dir: dir.path, reason: error.message, then: 'looked at again every second'});
            }
            run.errors[dir.path] = error.message;
            continue;
        }
        // The first look at a folder: what is in it now is from before, and is read from its end
        const first = (run.seen.dirs.includes(dir.path) === false);
        for (const file of found) {
            const id = `${file.stat.dev}:${file.stat.ino}`;
            if (run.seen.files[id] === undefined) {
                run.seen.files[id] = {start: (first ? file.stat.size : 0), cut: 0};
                changed = true;
            }
            count += 1;
            if (ctx.spool.full()) {
                continue;
            }
            // A file cut short is a new run of lines in the same file: counted under a key of
            // its own, so where the old run stood no longer applies
            const seen = run.seen.files[id];
            if (file_read(ctx, dir, file, key_of(ctx, id, seen.cut), seen.start) === 'truncated') {
                run.seen.files[id] = {start: 0, cut: seen.cut + 1};
                changed = true;
                file_read(ctx, dir, file, key_of(ctx, id, seen.cut + 1), 0);
            }
        }
        if (first) {
            run.seen.dirs.push(dir.path);
            changed = true;
        }
    }
    run.files = count;
    if (changed) {
        file_write_synced(agent_logline_path('files.json'), JSON.stringify(run.seen));
    }
}

// The key a file's lines are held under: the file, which run of lines in it, and the floor —
// so neither a truncation nor switching off and on again ever meets where an old run stood
function key_of(ctx, id, cut)
{
    return `file:${id}:${cut}@${ctx.floor}`;
}

// The files a folder or a pattern names: [{path, stat}], regular files only
function files_of(written)
{
    // ~/ is the home of whoever runs the agent
    const pattern = (written.startsWith('~/') ? path.join(os.homedir(), written.slice(2)) : written);
    const base = path.basename(pattern);
    const glob = base.includes('*');
    const dir = (glob ? path.dirname(pattern) : pattern);
    const re = (glob ? new RegExp(`^${base.split('*').map(v => v.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`) : null);
    const out = [];
    for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('.') || RE_SKIPPED.test(name) || (re !== null && re.test(name) === false)) {
            continue;
        }
        const full = path.join(dir, name);
        let stat;
        try {
            stat = fs.statSync(full);
        }
        catch {
            // Gone between the listing and the look
            continue;
        }
        if (stat.isFile()) {
            out.push({path: full, stat});
        }
    }
    out.sort((a, b) => (a.path < b.path ? -1 : 1));
    return out;
}

// Whatever whole lines a file has past where its reading stood; a line still being written —
// no newline yet — waits for the next look
function file_read(ctx, dir, file, key, start)
{
    const kept = ctx.spool.cursor(key);
    // Where it stood, and never before where this collection began with it: a cursor from an
    // earlier time the machine was switched on does not bring back what was written while off
    let offset = Math.max(start, (kept === null ? 0 : parseInt(kept.at, 10)));
    if (file.stat.size < offset) {
        ctx.say('logline_file_truncated', {file: file.path, was: offset, now: file.stat.size, then: 'read from its start'});
        return 'truncated';
    }
    if (file.stat.size === offset) {
        return 'read';
    }
    const fd = fs.openSync(file.path, 'r');
    try {
        while (offset < file.stat.size && ctx.spool.full() === false) {
            const chunk = Buffer.alloc(Math.min(READ_BYTES, file.stat.size - offset));
            const got = fs.readSync(fd, chunk, 0, chunk.length, offset);
            if (got === 0) {
                return 'read';
            }
            let start_at = 0;
            let newline = chunk.indexOf(10, 0);
            if (newline === -1 && got === READ_BYTES) {
                // A line longer than a whole read: taken as it is, cut the rules' way
                line_keep(ctx, dir, file, key, chunk.subarray(0, got), offset + got);
                offset += got;
                continue;
            }
            while (newline !== -1 && newline < got) {
                line_keep(ctx, dir, file, key, chunk.subarray(start_at, newline), offset + newline + 1);
                start_at = newline + 1;
                newline = chunk.indexOf(10, start_at);
            }
            if (start_at === 0) {
                return 'read';
            }
            offset += start_at;
        }
    }
    finally {
        fs.closeSync(fd);
    }
    return 'read';
}

function line_keep(ctx, dir, file, key, bytes, end)
{
    const stripped = logline_time_strip(bytes.toString('utf8').trimEnd());
    ctx.spool.append({
        src: key,
        // The offset past the line, padded so offsets compare as text, the way stamps do
        at: String(end).padStart(16, '0'),
        time: (stripped.time === null ? new Date().toISOString() : stripped.time),
        labels: {
            host: ctx.host,
            service: (dir.service === null || dir.service === '' ? path.basename(dir.path.includes('*') ? path.dirname(dir.path) : dir.path) : dir.service),
            file: file.path,
        },
        line: logline_line_cut(stripped.line),
    });
}

// What files.json says for this floor. Switched off and on again is a new floor, and then
// nothing seen before counts: every folder is looked at for the first time again.
function seen_read(floor)
{
    try {
        const out = JSON.parse(fs.readFileSync(agent_logline_path('files.json'), 'utf8'));
        if (out.floor === floor) {
            return {floor, dirs: out.dirs || [], files: out.files || {}};
        }
    }
    catch {
        // Never written, or not readable: nothing was seen
    }
    return {floor, dirs: [], files: {}};
}

module.exports = logline_files;

};
modules["agent/src/file_write_synced"] = function (module, exports, require) {
const fs = require('fs');
const path = require('path');

// A whole file, the way no crash leaves half of one: written beside, synced, renamed over the
// old one, and the folder synced so the rename itself is on disk when this returns
function file_write_synced(file, text, mode)
{
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
    const temp = `${file}.new`;
    const fd = fs.openSync(temp, 'w', (mode === undefined ? 0o600 : mode));
    try {
        fs.writeFileSync(fd, text);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
    const dir = fs.openSync(path.dirname(file), 'r');
    try {
        fs.fsyncSync(dir);
    }
    finally {
        fs.closeSync(dir);
    }
}

module.exports = file_write_synced;

};
modules["agent/src/logline_ship"] = function (module, exports, require) {
const file_write_synced = require('agent/src/file_write_synced');
const path = require('path');

const BATCH_LINES = 1000;
const BATCH_BYTES = 1024*1024;
const SEND_MS = 30000;
const IDLE_MS = 1000;
const WAIT_FIRST_MS = 1000;
const WAIT_LONGEST_MS = 60000;

// The spool, to Logline, one batch at a time and in order. A batch leaves the spool only when
// Logline answers 2xx; any other answer, or none, and the same batch goes again — the same
// bytes, which Logline stores once however often they come. A batch Logline refuses outright —
// a 4xx no retry can change — is put aside in refused/, said, and not deleted.
//
// ctx: {spool, dir, settings, stats, say} -> {stop, wake}
function logline_ship(ctx)
{
    const run = {running: true, wake: null};
    loop(ctx, run);
    return {
        stop: function () {
            run.running = false;
            wake(run);
        },
        wake: () => wake(run),
    };
}

async function loop(ctx, run)
{
    const state = {wait_ms: WAIT_FIRST_MS};
    while (run.running) {
        try {
            await round(ctx, run, state);
        }
        catch (error) {
            // Whatever broke, the lines are still in the spool: said, and tried again
            ctx.say('logline_ship_error', {reason: error.message, then: 'tried again'});
            await sleep(run, WAIT_LONGEST_MS);
        }
    }
}

// One batch, sent — or the wait before the next try
async function round(ctx, run, state)
{
    const cut = ctx.spool.batch(BATCH_LINES, BATCH_BYTES);
    if (cut === null) {
        await sleep(run, IDLE_MS);
        return;
    }
    const settings = ctx.settings();
    const answer = await send(settings, cut.body);
    if (run.running === false) {
        return;
    }
    if (answer.ok) {
        ctx.spool.ack(cut);
        stats_add(ctx, cut, 'ok');
        if (ctx.stats.failing !== null) {
            ctx.say('logline_ship_ok', {after: ctx.stats.failing, sent: cut.count});
            ctx.stats.failing = null;
        }
        state.wait_ms = WAIT_FIRST_MS;
        return;
    }
    if (answer.refused) {
        // Nothing will make Logline take it: it is kept aside, whole, and the rest go on
        file_write_synced(path.join(ctx.dir, 'refused', `${cut.first}-${cut.last}.json`), JSON.stringify({answer: answer.text, batch: JSON.parse(cut.body)}));
        ctx.spool.ack(cut);
        stats_add(ctx, cut, answer.text);
        ctx.say('logline_batch_refused', {first: cut.first, last: cut.last, lines: cut.count, reason: answer.text, kept: `refused/${cut.first}-${cut.last}.json`});
        return;
    }
    ctx.stats.last_answer = answer.text;
    // Said once per reason: a Logline away for an hour is one line, not a line a minute
    if (ctx.stats.failing !== answer.text) {
        ctx.say('logline_ship_error', {reason: answer.text, waiting: ctx.spool.stats().waiting_lines, then: 'the same batch again, until it is taken'});
        ctx.stats.failing = answer.text;
    }
    await sleep(run, state.wait_ms);
    state.wait_ms = Math.min(state.wait_ms*2, WAIT_LONGEST_MS);
}

// {ok} for a 2xx, {refused} for an answer no retry changes, and why in `text`
async function send(settings, body)
{
    if (settings.logs !== 'all' || settings.endpoint === null || settings.token === null) {
        return {ok: false, refused: false, text: 'this machine is not told where to send'};
    }
    let res;
    try {
        res = await fetch(settings.endpoint, {
            method: 'POST',
            headers: {'authorization': `Bearer ${settings.token}`, 'content-type': 'application/json'},
            body,
            signal: AbortSignal.timeout(SEND_MS),
        });
    }
    catch (error) {
        return {ok: false, refused: false, text: (error.cause === undefined ? error.message : error.cause.message)};
    }
    const text = await res.text().catch(() => '');
    let said = text;
    try {
        said = JSON.parse(text).error || text;
    }
    catch {
        // Not Logline's JSON; the text is what there is
    }
    if (res.status >= 200 && res.status <= 299) {
        return {ok: true, refused: false, text: 'ok'};
    }
    // A wrong token, a wrong address, a Logline too busy: none of it is the batch's fault
    const retried = [401, 403, 404, 408, 425, 429];
    return {ok: false, refused: (res.status >= 400 && res.status <= 499 && retried.includes(res.status) === false), text: `${res.status} ${said}`.trim()};
}

function stats_add(ctx, cut, answer)
{
    ctx.stats.sent_lines += (answer === 'ok' ? cut.count : 0);
    ctx.stats.sent_batches += (answer === 'ok' ? 1 : 0);
    ctx.stats.sent_bytes += (answer === 'ok' ? Buffer.byteLength(cut.body) : 0);
    ctx.stats.last_sent_at = new Date().toISOString();
    ctx.stats.last_answer = answer;
    file_write_synced(path.join(ctx.dir, 'stats.json'), JSON.stringify({
        sent_lines: ctx.stats.sent_lines,
        sent_batches: ctx.stats.sent_batches,
        sent_bytes: ctx.stats.sent_bytes,
        last_sent_at: ctx.stats.last_sent_at,
        last_answer: ctx.stats.last_answer,
    }));
}

function sleep(run, ms)
{
    return new Promise(function (resolve) {
        const timer = setTimeout(done, ms);
        run.wake = done;
        function done() {
            clearTimeout(timer);
            run.wake = null;
            resolve();
        }
    });
}

function wake(run)
{
    if (run.wake !== null) {
        run.wake();
    }
}

module.exports = logline_ship;

};
modules["agent/src/logline_spool"] = function (module, exports, require) {
const file_write_synced = require('agent/src/file_write_synced');
const fs = require('fs');
const path = require('path');

const SEGMENT_BYTES = 16*1024*1024;
const SYNC_MS = 200;
const READ_BYTES = 2*1024*1024;
// Collection goes on again once the spool is this far under its cap, not the moment one batch
// leaves: a machine at its cap would otherwise stop and start with every batch
const ROOM_AT = 0.9;
const RE_SEGMENT = /^(\d{16})\.jsonl$/;

// The lines on their way to Logline, on this machine's disk. A line counts as collected once it
// is synced here, and leaves only after Logline has said it has it.
//
//     segments   0000000000000001.jsonl …   one record a line, append-only, 16M each
//     acked.json                            the last seq Logline has
//     inflight.json                         the batch being sent: sent again, the same, until acked
//     cursors.json                          where each container was, at the end of what was deleted
//
// The spool is its own cursor: where a container's reading stood is read back from the records
// themselves, so there is no second file to fall out of step with them. What a deleted segment
// knew is kept in cursors.json, with the last seq it covers, so nothing is counted twice.
//
// options: {cap_bytes, segment_bytes, sync_ms, on_data}
function logline_spool(dir, options)
{
    fs.mkdirSync(dir, {recursive: true, mode: 0o700});
    const spool = {
        dir,
        cap_bytes: options.cap_bytes,
        // A segment goes only when all of it is acked, so a small cap gets small segments
        segment_bytes: (options.segment_bytes === undefined ? Math.max(4096, Math.min(SEGMENT_BYTES, Math.floor(options.cap_bytes/8))) : options.segment_bytes),
        on_data: options.on_data || nothing,
        segments: [],
        buffer: [],
        fd: null,
        next_seq: 1,
        acked: 0,
        inflight: null,
        cursors: {},
        deleted: {upto: 0, cursors: {}},
        reader: null,
        waiting_bytes: 0,
        room_waiters: [],
        timer: null,
    };
    recover(spool);
    spool.timer = setInterval(function () {
        flush(spool);
    }, (options.sync_ms === undefined ? SYNC_MS : options.sync_ms));
    spool.timer.unref();
    return {
        append: v => append(spool, v),
        flush: () => flush(spool),
        batch: (max_items, max_bytes) => batch(spool, max_items, max_bytes),
        ack: v => ack(spool, v),
        cursor: v => (spool.cursors[v] === undefined ? null : spool.cursors[v]),
        full: () => full(spool),
        room: () => room(spool),
        stats: () => stats(spool),
        close: () => close(spool),
    };
}

// A record: {src, at, time, labels, line}. It is given its seq and waits in memory for the next
// sync — which is at most 200ms off, and is what makes it collected.
function append(spool, record)
{
    const item = {seq: spool.next_seq, src: record.src, at: record.at, time: record.time, labels: record.labels, line: record.line};
    spool.next_seq += 1;
    const text = `${JSON.stringify(item)}\n`;
    spool.buffer.push(text);
    spool.waiting_bytes += Buffer.byteLength(text);
    cursor_apply(spool.cursors, item);
    return item.seq;
}

// Everything in memory, onto the disk and synced
function flush(spool)
{
    if (spool.buffer.length === 0) {
        return;
    }
    const text = spool.buffer.join('');
    const first_seq = spool.next_seq - spool.buffer.length;
    spool.buffer = [];
    let segment = spool.segments[spool.segments.length - 1];
    if (segment === undefined || segment.closed) {
        segment = {name: `${String(first_seq).padStart(16, '0')}.jsonl`, first: first_seq, last: first_seq - 1, size: 0, closed: false, cursors_at_end: null};
        spool.segments.push(segment);
        spool.fd = fs.openSync(path.join(spool.dir, segment.name), 'a', 0o600);
        dir_sync(spool.dir);
    }
    const bytes = Buffer.from(text);
    fs.writeSync(spool.fd, bytes);
    fs.fdatasyncSync(spool.fd);
    segment.size += bytes.length;
    segment.last = spool.next_seq - 1;
    if (spool.reader === null) {
        spool.reader = {segment: spool.segments.indexOf(segment), offset: segment.size - bytes.length, seq: first_seq};
    }
    if (segment.size >= spool.segment_bytes) {
        segment_close(spool, segment);
    }
    spool.on_data();
}

function segment_close(spool, segment)
{
    fs.closeSync(spool.fd);
    spool.fd = null;
    segment.closed = true;
    segment.cursors_at_end = JSON.parse(JSON.stringify(spool.cursors));
}

// The records waiting to be sent, from the oldest, up to either limit: {first, last, body,
// count, bytes, end}. The batch being sent is remembered, on disk too, and asked for again it is
// the same batch — the same bytes, so Logline stores it once however often it comes.
function batch(spool, max_items, max_bytes)
{
    if (spool.reader === null) {
        return null;
    }
    const wanted = spool.inflight;
    const items = [];
    const at = {segment: spool.reader.segment, offset: spool.reader.offset};
    let first = null;
    let last = null;
    let bytes = 0;
    while (at.segment < spool.segments.length) {
        const segment = spool.segments[at.segment];
        // Only as many as could still go in, not the rest of a 16M segment
        const records = records_read(spool, segment, at.offset, (wanted === null ? max_items - items.length : wanted.last - (last === null ? spool.reader.seq : last + 1) + 1));
        let stop = false;
        for (const item of records) {
            const fits = (wanted === null ? (items.length < max_items && (items.length === 0 || bytes + item.bytes <= max_bytes)) : item.record.seq <= wanted.last);
            if (fits === false) {
                stop = true;
                break;
            }
            items.push({time: item.record.time, labels: item.record.labels, line: item.record.line});
            first = (first === null ? item.record.seq : first);
            last = item.record.seq;
            bytes += item.bytes;
            at.offset = item.end;
        }
        // Full, or the batch being sent is whole again: the reader stays where the batch ends,
        // not at the start of some later segment nothing was taken from
        if (stop || (wanted !== null && last === wanted.last) || (wanted === null && items.length >= max_items)) {
            break;
        }
        if (segment.closed === false) {
            break;
        }
        at.segment += 1;
        at.offset = 0;
    }
    if (items.length === 0) {
        return null;
    }
    const out = {first, last, count: items.length, bytes, body: JSON.stringify(items), end: at};
    if (wanted === null) {
        spool.inflight = {first, last};
        file_write_synced(path.join(spool.dir, 'inflight.json'), JSON.stringify(spool.inflight));
    }
    return out;
}

// Logline has the batch: the records in it leave, and so does every segment nothing waits in
function ack(spool, cut)
{
    spool.acked = cut.last;
    file_write_synced(path.join(spool.dir, 'acked.json'), JSON.stringify({seq: spool.acked}));
    spool.inflight = null;
    fs.rmSync(path.join(spool.dir, 'inflight.json'), {force: true});
    spool.waiting_bytes = Math.max(0, spool.waiting_bytes - cut.bytes);
    spool.reader = {segment: cut.end.segment, offset: cut.end.offset, seq: cut.last + 1};
    let done = 0;
    while (done < spool.segments.length && spool.segments[done].closed && spool.segments[done].last <= spool.acked) {
        done += 1;
    }
    if (done > 0) {
        // What they knew about where each container stood is kept before they go
        spool.deleted = {upto: spool.segments[done - 1].last, cursors: spool.segments[done - 1].cursors_at_end};
        file_write_synced(path.join(spool.dir, 'cursors.json'), JSON.stringify(spool.deleted));
        for (const segment of spool.segments.slice(0, done)) {
            fs.rmSync(path.join(spool.dir, segment.name), {force: true});
        }
        spool.segments = spool.segments.slice(done);
        // A batch that ended exactly at the end of a segment leaves the reader there; that
        // segment is gone now, and the next record is at the start of the next one
        spool.reader = (spool.reader.segment < done ? {segment: 0, offset: 0, seq: spool.reader.seq} : {segment: spool.reader.segment - done, offset: spool.reader.offset, seq: spool.reader.seq});
    }
    if (spool.waiting_bytes < spool.cap_bytes*ROOM_AT) {
        const waiters = spool.room_waiters;
        spool.room_waiters = [];
        for (const resolve of waiters) {
            resolve();
        }
    }
}

// Full is what waits to be sent, not what is on the disk: acked lines leave with their segment,
// and a spool that counted them would wait for itself
function full(spool)
{
    return spool.waiting_bytes >= spool.cap_bytes;
}

// Resolves when there is room again
function room(spool)
{
    if (full(spool) === false) {
        return Promise.resolve();
    }
    return new Promise(v => spool.room_waiters.push(v));
}

function disk_bytes(spool)
{
    let out = 0;
    for (const segment of spool.segments) {
        out += segment.size;
    }
    for (const text of spool.buffer) {
        out += text.length;
    }
    return out;
}

function stats(spool)
{
    let oldest = null;
    if (spool.reader !== null && spool.reader.segment < spool.segments.length) {
        const first = records_read(spool, spool.segments[spool.reader.segment], spool.reader.offset, 1)[0];
        // The line's time: a file's lines hold their place as a byte offset, not a moment
        oldest = (first === undefined ? null : (first.record.time || first.record.at));
    }
    return {
        waiting_lines: spool.next_seq - 1 - spool.acked,
        waiting_bytes: spool.waiting_bytes,
        oldest_at: oldest,
        disk_bytes: disk_bytes(spool),
        cap_bytes: spool.cap_bytes,
    };
}

function close(spool)
{
    clearInterval(spool.timer);
    flush(spool);
    if (spool.fd !== null) {
        fs.closeSync(spool.fd);
        spool.fd = null;
    }
}

// Records of a segment from a byte offset: [{record, bytes, end}], only what is synced
function records_read(spool, segment, offset, limit)
{
    const out = [];
    const fd = fs.openSync(path.join(spool.dir, segment.name), 'r');
    try {
        let at = offset;
        let rest = Buffer.alloc(0);
        while (at < segment.size && (limit === undefined || out.length < limit)) {
            const chunk = Buffer.alloc(Math.min(READ_BYTES, segment.size - at));
            const got = fs.readSync(fd, chunk, 0, chunk.length, at);
            if (got === 0) {
                break;
            }
            at += got;
            const text = Buffer.concat([rest, chunk.subarray(0, got)]);
            let start = 0;
            for (;;) {
                const newline = text.indexOf(10, start);
                if (newline === -1 || (limit !== undefined && out.length >= limit)) {
                    break;
                }
                const line = text.subarray(start, newline + 1);
                out.push({record: JSON.parse(line.toString('utf8')), bytes: line.length, end: at - text.length + newline + 1});
                start = newline + 1;
            }
            rest = text.subarray(start);
        }
    }
    finally {
        fs.closeSync(fd);
    }
    return out;
}

// The spool as the last process left it. A last line cut short by a crash is cut off: what it
// held was never synced, so it was never collected, and is read from docker again.
function recover(spool)
{
    const kept = json_read(path.join(spool.dir, 'acked.json'), {seq: 0});
    spool.acked = kept.seq;
    spool.inflight = json_read(path.join(spool.dir, 'inflight.json'), null);
    spool.deleted = json_read(path.join(spool.dir, 'cursors.json'), {upto: 0, cursors: {}});
    spool.cursors = JSON.parse(JSON.stringify(spool.deleted.cursors));
    const names = fs.readdirSync(spool.dir).filter(v => RE_SEGMENT.test(v)).sort();
    let next = Math.max(spool.acked, spool.deleted.upto) + 1;
    for (let i = 0; i < names.length; i++) {
        const file = path.join(spool.dir, names[i]);
        let size = fs.statSync(file).size;
        const segment = {name: names[i], first: parseInt(RE_SEGMENT.exec(names[i])[1], 10), last: 0, size, closed: true, cursors_at_end: null};
        segment.last = segment.first - 1;
        const records = records_whole(file, size);
        if (records.size !== size) {
            fs.truncateSync(file, records.size);
            size = records.size;
            segment.size = size;
        }
        for (const item of records.list) {
            if (item.record.seq > spool.deleted.upto) {
                cursor_apply(spool.cursors, item.record);
            }
            if (item.record.seq > spool.acked) {
                spool.waiting_bytes += item.bytes;
                if (spool.reader === null) {
                    spool.reader = {segment: i, offset: item.end - item.bytes, seq: item.record.seq};
                }
            }
            segment.last = item.record.seq;
            next = item.record.seq + 1;
        }
        segment.cursors_at_end = JSON.parse(JSON.stringify(spool.cursors));
        spool.segments.push(segment);
    }
    spool.next_seq = next;
    // The last segment goes on taking records
    const last = spool.segments[spool.segments.length - 1];
    if (last !== undefined && last.size < spool.segment_bytes) {
        last.closed = false;
        spool.fd = fs.openSync(path.join(spool.dir, last.name), 'a', 0o600);
    }
    if (spool.inflight !== null && spool.inflight.last <= spool.acked) {
        spool.inflight = null;
    }
}

// Every whole record in a file, and how many bytes they are: a last line without its newline
// is not one
function records_whole(file, size)
{
    const list = [];
    const text = fs.readFileSync(file);
    let start = 0;
    for (;;) {
        const newline = text.indexOf(10, start);
        if (newline === -1 || newline >= size) {
            break;
        }
        let record;
        try {
            record = JSON.parse(text.subarray(start, newline).toString('utf8'));
        }
        catch {
            break;
        }
        list.push({record, bytes: newline + 1 - start, end: newline + 1});
        start = newline + 1;
    }
    return {list, size: start};
}

// Where a container's reading stood: the latest stamp, and how many of its lines share it
function cursor_apply(cursors, record)
{
    const found = cursors[record.src];
    if (found === undefined || record.at > found.at) {
        cursors[record.src] = {at: record.at, n: 1};
    }
    else if (record.at === found.at) {
        found.n += 1;
    }
}

function nothing()
{
}

function json_read(file, fallback)
{
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return fallback;
        }
        throw error;
    }
}

function dir_sync(dir)
{
    const fd = fs.openSync(dir, 'r');
    try {
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
}

module.exports = logline_spool;

};
modules["agent/src/agent_peer_serve"] = function (module, exports, require) {
const agent_addresses = require('agent/src/agent_addresses');
const agent_door_proxy = require('agent/src/agent_door_proxy');
const agent_door_upgrade = require('agent/src/agent_door_upgrade');
const agent_doors_state = require('agent/src/agent_doors_state');
const agent_http_error = require('agent/src/agent_http_error');
const agent_say = require('agent/src/agent_say');
const agent_service_target = require('agent/src/agent_service_target');
const crypto = require('crypto');
const http = require('http');
const log_uid = require('helpers/log_uid');

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
    const port = (options.peer_port === '' ? PEER_PORT : parseInt(options.peer_port, 10));
    if (port === 0 || Number.isNaN(port)) {
        return;
    }
    const hosts = (options.peer_host === '' ? agent_addresses().filter(is_tailnet) : [options.peer_host]);
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
    const target = (found.refused === undefined ? await agent_service_target(agent_doors_state.table, found.service, options) : null);
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
    if (table === null || same(token, table.token) === false) {
        return {status: 403, refused: 'not a machine of this fleet'};
    }
    const where_is = table.services[service];
    if (where_is === undefined || where_is.machine !== table.self) {
        return {status: 404, refused: `${service || 'that'} does not run on ${table.self}`};
    }
    return {service};
}

// Whether two tokens are one, in the same time whatever they are
function same(given, wanted)
{
    const a = Buffer.from(given);
    const b = Buffer.from(String(wanted));
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

// A tailnet address: tailscale's 100.64.0.0/10, and its fd7a:115c:a1e0::/48
function is_tailnet(address)
{
    const v4 = /^100\.(\d+)\./.exec(address);
    if (v4 !== null) {
        const second = Number(v4[1]);
        return second >= 64 && second <= 127;
    }
    return address.toLowerCase().startsWith('fd7a:115c:a1e0:');
}

module.exports = agent_peer_serve;

};
modules["agent/src/agent_addresses"] = function (module, exports, require) {
const os = require('os');

// Bridges docker and its kin make on every machine alike: an address on one says nothing about
// which machine a caller is
const RE_BRIDGE = /^(docker\d*|br-|veth|podman|cni|virbr)/;

// The addresses other machines may see this one at — the ones Logline binds its token to.
// Loopback, link-local and container bridges are left out: every machine has the same ones.
function agent_addresses()
{
    const out = [];
    const all = os.networkInterfaces();
    for (const name of Object.keys(all)) {
        if (RE_BRIDGE.test(name)) {
            continue;
        }
        for (const item of all[name]) {
            if (item.internal || item.address.toLowerCase().startsWith('fe80:')) {
                continue;
            }
            if (out.includes(item.address) === false) {
                out.push(item.address);
            }
        }
    }
    out.sort();
    return out;
}

module.exports = agent_addresses;

};
modules["agent/src/agent_root_serve"] = function (module, exports, require) {
const agent_apt = require('agent/src/agent_apt');
const agent_built = require('agent/src/agent_built');
const agent_port_list = require('agent/src/agent_port_list');
const agent_root_socket = require('agent/src/agent_root_socket');
const agent_say = require('agent/src/agent_say');
const child_process = require('child_process');
const fs = require('fs');
const log_uid = require('helpers/log_uid');
const net = require('net');

const SOCKET_MODE = 0o600;

// The root half of one machine. It dials nowhere and listens on nothing but a file: no port,
// no link, no way in from another machine at all. What may reach it is whatever may open that
// file, which is the agent running in the person's own session — and that is the whole of the
// permission. Being root is what it is for: nothing here runs sudo, and no line in sudoers
// says which commands are allowed, because the answer is "the ones written below".
function agent_root_serve(options)
{
    const path = agent_root_socket(options);
    const boot = log_uid();
    const state = {};
    agent_say(boot, 'group_spawn', undefined);
    stale_remove(path);
    const server = net.createServer(function (socket) {
        job_read(state, options, socket, boot);
    });
    server.on('error', function (error) {
        agent_say(boot, 'root_error', {reason: error.message});
        process.exit(1);
    });
    server.listen(path, function () {
        const owner = owner_set(path, options);
        agent_say(boot, 'root_begin', {socket: path, user: owner, root: (process.getuid !== undefined && process.getuid() === 0)});
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, function () {
            stale_remove(path);
            process.exit(0);
        });
    }
}

// Who may ask. The socket is the permission, so it is given to one person by name — the one
// whose session runs the agent — and to nobody else.
function owner_set(path, options)
{
    fs.chmodSync(path, SOCKET_MODE);
    const user = (options.root_for === '' ? (process.env.SUDO_USER || '') : options.root_for);
    if (user === '') {
        return null;
    }
    try {
        const uid = parseInt(child_process.execFileSync('id', ['-u', user], {encoding: 'utf8'}).trim(), 10);
        const gid = parseInt(child_process.execFileSync('id', ['-g', user], {encoding: 'utf8'}).trim(), 10);
        fs.chownSync(path, uid, gid);
        return user;
    }
    catch {
        // Not root, or no such person here: the socket keeps the owner it was made with, and
        // the line above says who that is
        return null;
    }
}

// What keeps this half up, taken away. Nothing else on the machine is touched: the unit is
// this program's own, and the folder it runs from belongs to the session half, which removes
// it after this one has gone.
function unit_gone()
{
    const unit = '/etc/systemd/system/serviceman-agent-root.service';
    try {
        child_process.execFileSync('systemctl', ['disable', '--now', 'serviceman-agent-root'], {stdio: 'ignore'});
    }
    catch {
        // Not under systemd, or already disabled; the file below is what is left
    }
    try {
        fs.unlinkSync(unit);
        child_process.execFileSync('systemctl', ['daemon-reload'], {stdio: 'ignore'});
        return {unit: 'taken away'};
    }
    catch (error) {
        return {unit: `left as it is — ${error.message}`};
    }
}

// A socket file left behind by a copy that is gone. Nothing else may be removed: a path that
// is not a socket is somebody's file, and this one refuses to start rather than eat it.
function stale_remove(path)
{
    try {
        if (fs.statSync(path).isSocket()) {
            fs.unlinkSync(path);
        }
    }
    catch {
        // It is not there, which is how it should be
    }
}

// One connection is one job: a line of json says what to do, and everything after it belongs
// to that job alone
function job_read(state, options, socket, group)
{
    let rest = '';
    socket.on('error', function () {
        // The asker went; the job below ends with the socket it was asked over
    });
    socket.on('data', function on_data(chunk) {
        rest += chunk.toString('utf8');
        const at = rest.indexOf('\n');
        if (at === -1) {
            return;
        }
        socket.off('data', on_data);
        const job = job_from_line(rest.slice(0, at));
        if (job === null) {
            reply(socket, false, undefined, 'that is not a job this agent can read');
            return;
        }
        job_run(state, options, socket, job, group);
    });
}

function job_run(state, options, socket, job, group)
{
    function say(stream, text) {
        line_send(socket, stream, text);
    }
    agent_say(group, 'root_job_begin', {method: job.method});
    const promise = method_run(state, options, job, say);
    promise.then(function (value) {
        agent_say(group, 'root_job_end_ok', {method: job.method});
        reply(socket, true, value, undefined);
    }, function (error) {
        agent_say(group, 'root_job_end_error', {method: job.method, reason: error.message});
        reply(socket, false, undefined, error.message);
    });
}

async function method_run(state, options, job, say)
{
    const method = String(job.method);
    job.params = (job.params === undefined || job.params === null ? {} : job.params);
    if (method === 'ping') {
        return {
            at: Date.now(),
            root: (process.getuid !== undefined && process.getuid() === 0),
            built: agent_built,
            // Whether something starts it again when it stops. systemd says so by name, and a
            // copy run by hand from a terminal says no — it is never asked to step aside for a
            // new file, because nothing would bring it back.
            supervised: (process.env.INVOCATION_ID !== undefined && process.env.SERVICEMAN_ROOT_SUPERVISED !== 'no'),
        };
    }
    if (method === 'restart') {
        // An update replaced the file this is running from. Nothing here reloads code, so it
        // ends and systemd starts the new one — the answer goes first, because after this
        // there is nobody here to answer with.
        setTimeout(function () {
            process.exit(0);
        }, 200);
        return {stopping: true};
    }
    if (method === 'port_list') {
        // ss names the holder of a socket only to whoever may read that socket, which for the
        // agent in a person's session is its own and nothing else. Here it is every one on
        // the machine — sshd, resolved, the daemons nobody logs in as.
        return await agent_port_list();
    }
    if (method === 'apt_upgrade') {
        return await agent_apt(state, options, say);
    }
    if (method === 'apt_cancel') {
        return agent_apt.cancel(state);
    }
    if (method === 'uninstall') {
        // The machine has been taken out of the host's config, and the session half is going
        // with it. What keeps this one up is taken away first, then it ends.
        const out = unit_gone();
        setTimeout(function () {
            process.exit(0);
        }, 200);
        return out;
    }
    throw new Error(`the root agent knows nothing called ${JSON.stringify(method)}`);
}

function line_send(socket, stream, text)
{
    socket.write(`${JSON.stringify({type: 'line', stream, text})}\n`);
}

function reply(socket, ok, value, error)
{
    socket.write(`${JSON.stringify({type: 'reply', ok, value, error})}\n`);
    socket.end();
}

function job_from_line(line)
{
    try {
        const out = JSON.parse(line);
        return (out === null || typeof out !== 'object' || typeof out.method !== 'string' ? null : out);
    }
    catch {
        return null;
    }
}

module.exports = agent_root_serve;

};
modules["agent/src/agent_apt"] = function (module, exports, require) {
const agent_updates = require('agent/src/agent_updates');
const child_process = require('child_process');
const stream = require('stream');
const stream_each = require('@vbarbarosh/node-helpers/src/stream_each');
const stream_lines = require('@vbarbarosh/node-helpers/src/stream_lines');
const stream_terminal_text = require('helpers/stream_terminal_text');

// What a person would type, with the answers to its questions given in advance: nothing here
// may stop and wait for a keyboard, because there is nobody at this end of it. A config file
// the machine's owner changed is kept as it is — apt asking about it is apt asking a person.
const ANSWERS = '-y -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef';
const KEEP_LINES = 200;
const KILL_AFTER_MS = 10000;

// Installs what is waiting, saying every line as apt prints it. One run at a time on a
// machine: two apt-gets at once is a lock fight, not twice the work.
function agent_apt_upgrade(state, options, say)
{
    if (state.apt !== undefined && state.apt !== null) {
        return Promise.resolve({ok: false, stderr: 'apt is already running on this machine'});
    }
    // Both apt-gets are run through whatever this machine says apt-get is — `sudo -n apt-get`
    // where the agent is not root, so a sudoers line may name apt-get and nothing else; a line
    // that named a shell would be root with extra words.
    const apt = apt_command(options);
    const line = `${apt} update && ${apt} ${ANSWERS} upgrade`;
    const child = child_process.spawn('/bin/sh', ['-c', line], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        env: Object.assign({}, process.env, {DEBIAN_FRONTEND: 'noninteractive'}),
    });
    state.apt = child;
    const kept = {stdout: [], stderr: []};
    function read(name, source) {
        return stream.promises.pipeline(source, stream_terminal_text(), stream_lines(), stream_each(function (text) {
            kept[name].push(text);
            if (kept[name].length > KEEP_LINES) {
                kept[name].shift();
            }
            if (say !== undefined && say !== null && text.trim() !== '') {
                say(name, text);
            }
        }));
    }
    const done = new Promise(function (resolve) {
        child.once('error', function (error) {
            kept.stderr.push(error.message);
            resolve(-1);
        });
        child.once('close', function (code) {
            resolve(code);
        });
    });
    return Promise.all([done, read('stdout', child.stdout), read('stderr', child.stderr)]).then(function (all) {
        state.apt = null;
        const cancelled = (state.apt_cancelled === true);
        state.apt_cancelled = false;
        // What is waiting has just changed, and the file ubuntu keeps the count in is written
        // once a day — so the next answer is counted from apt itself
        agent_updates.recount();
        return {
            ok: (all[0] === 0),
            cancelled,
            code: all[0],
            stdout: kept.stdout.join('\n').trim(),
            stderr: kept.stderr.join('\n').trim(),
        };
    });
}

// What apt-get is on this machine: as given, or with sudo in front of it where the agent is
// not root — which is every machine where it runs as the person who logs in
function apt_command(options)
{
    if (options !== undefined && options.apt !== undefined && options.apt !== '') {
        return options.apt;
    }
    return (process.getuid !== undefined && process.getuid() === 0 ? 'apt-get' : 'sudo -n apt-get');
}

// Stops the run that is going: the whole group, because apt is a shell line that started
// others. It is asked first the way ctrl-c asks, and made to stop if it will not.
function agent_apt_cancel(state)
{
    const child = state.apt;
    if (child === undefined || child === null) {
        return {stopped: false, reason: 'nothing is being installed on this machine'};
    }
    state.apt_cancelled = true;
    kill(child.pid, 'SIGINT');
    setTimeout(function () {
        if (state.apt === child) {
            kill(child.pid, 'SIGKILL');
        }
    }, KILL_AFTER_MS);
    return {stopped: true};
}

function kill(pid, signal)
{
    try {
        process.kill(-pid, signal);
    }
    catch {
        try {
            process.kill(pid, signal);
        }
        catch {
            // It ended between the looking and the signalling, which is the outcome anyway
        }
    }
}

agent_apt_upgrade.cancel = agent_apt_cancel;

module.exports = agent_apt_upgrade;

};
modules["agent/src/agent_updates"] = function (module, exports, require) {
const agent_apt_binary = require('agent/src/agent_apt_binary');
const agent_shell = require('agent/src/agent_shell');
const fs = require('fs');

const UPDATES_FILE = '/var/lib/update-notifier/updates-available';
const REBOOT_FILE = '/var/run/reboot-required';

// What ubuntu counted for its own login banner, and — after an upgrade this agent ran — what
// apt says now. The banner file is written once a day, so on its own it would go on saying
// "28 to install" for hours after the 28 were installed. Counting from apt costs a second and
// reads the whole package list, which is why it is done when something changed and not on
// every heartbeat.
let counted = null;
let counted_at = 0;
let wanted = false;

async function agent_updates(options)
{
    if (wanted) {
        wanted = false;
        counted = await counts_from_apt(options);
        counted_at = Date.now();
    }
    const reboot = fs.existsSync(REBOOT_FILE);
    const said = counts_from_file();
    // Whichever of the two knows about the newer state of the machine
    if (counted !== null && (said === null || counted_at > file_at())) {
        return {pending: counted.pending, security: counted.security, reboot};
    }
    if (said === null) {
        return (reboot ? {pending: null, security: null, reboot} : null);
    }
    return {pending: said.pending, security: said.security, reboot};
}

// Ask apt what an upgrade would install now. `-s` changes nothing and needs no root, so this
// is safe to run as whoever the agent is.
async function counts_from_apt(options)
{
    const answer = await agent_shell([agent_apt_binary(options), '-s', 'upgrade']);
    if (answer.ok === false) {
        return null;
    }
    const lines = answer.stdout.split('\n').filter(v => v.startsWith('Inst '));
    return {
        pending: lines.length,
        // apt names the archive a package comes from, and a security archive says so
        security: lines.filter(v => /-security[ /\]]/.test(v)).length,
    };
}

function counts_from_file()
{
    try {
        const text = fs.readFileSync(UPDATES_FILE, 'utf8');
        const out = {pending: 0, security: 0};
        const pending = /(\d+) updates? can be applied/.exec(text);
        if (pending !== null) {
            out.pending = parseInt(pending[1], 10);
        }
        const security = /(\d+)[^\n]*security/.exec(text);
        if (security !== null) {
            out.security = parseInt(security[1], 10);
        }
        return out;
    }
    catch {
        // no update-notifier here
        return null;
    }
}

function file_at()
{
    try {
        return fs.statSync(UPDATES_FILE).mtimeMs;
    }
    catch {
        return 0;
    }
}

// Said by an upgrade that has just ended: what is waiting is not what the file says any more
agent_updates.recount = function () {
    wanted = true;
};

module.exports = agent_updates;

};
modules["agent/src/agent_apt_binary"] = function (module, exports, require) {
// What apt-get is on this machine, without anything in front of it. The real work goes
// through sudo where the agent is not root; asking apt what it would do needs no such thing.
function agent_apt_binary(options)
{
    if (options !== undefined && options.apt !== undefined && options.apt !== '') {
        return options.apt;
    }
    return 'apt-get';
}

module.exports = agent_apt_binary;

};
modules["@vbarbarosh/node-helpers/src/stream_each"] = function (module, exports, require) {
const stream = require('stream');

/**
 * Pass each item to a simple function. This is a final step.
 */
function stream_each(fn)
{
    return stream.Writable({
        objectMode: true,
        write: async function (item, encoding, callback) {
            try {
                await fn(item);
                callback();
            }
            catch (error) {
                callback(error);
            }
        }
    });
}

module.exports = stream_each;

};
modules["@vbarbarosh/node-helpers/src/stream_lines"] = function (module, exports, require) {
const stream_strpbrk = require('@vbarbarosh/node-helpers/src/stream_strpbrk');

/**
 * Split stream into lines
 */
function stream_lines()
{
    return stream_strpbrk('\r\n');
}

module.exports = stream_lines;

};
modules["@vbarbarosh/node-helpers/src/stream_strpbrk"] = function (module, exports, require) {
const stream = require('stream');

/**
 * Split the input stream by consecutive delimiters in `chars`
 */
function stream_strpbrk(chars = '\r\n')
{
    const pending = [];
    return new stream.Transform({
        objectMode: true,
        transform: function (str, encoding, callback) {
            str = Buffer.isBuffer(str) ? str.toString() : str;

            let off = 0;
            // leading delimiters
            while (off < str.length) {
                if (!chars.includes(str[off])) {
                    break;
                }
                off++;
            }

            if (off && pending.length) {
                this.push(''.concat(...pending.splice(0)));
            }

            while (off < str.length) {
                // skip consecutive delimiters
                while (off < str.length) {
                    let stop = true;
                    for (let i = 0, end = chars.length; i < end; ++i) {
                        if (str[off] === chars[i]) {
                            off++;
                            stop = false;
                            break;
                        }
                    }
                    if (stop) {
                        break;
                    }
                }

                // find next delimiter
                const delims = [];
                for (let i = 0, end = chars.length; i < end; ++i) {
                    const j = str.indexOf(chars[i], off);
                    if (j !== -1) {
                        delims.push(j);
                    }
                }

                // no delimiters were found
                if (!delims.length) {
                    const tmp = str.slice(off);
                    if (tmp.length) {
                        pending.push(tmp);
                    }
                    callback();
                    return;
                }

                delims.sort(fcmp);
                pending.push(str.slice(off, delims[0]));
                this.push(''.concat(...pending.splice(0)));
                off = delims[0];
            }
            callback();
        },
        flush: function (callback) {
            if (pending.length) {
                this.push(''.concat(...pending.splice(0)));
            }
            callback();
        },
    });
}

function fcmp(a, b)
{
    return a - b;
}

module.exports = stream_strpbrk;

};
modules["helpers/stream_terminal_text"] = function (module, exports, require) {
const stream = require('stream');

// Output written for a screen, made into lines. A progress meter draws itself with carriage
// returns and cursor moves — `\r` is the end of a line as much as `\n` is, and the escapes
// belong to a terminal that is not there.
const RE_ESCAPE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][A-Z0-9]|\x1b[=>]/g;

function stream_terminal_text()
{
    return new stream.Transform({
        transform: function (buffer, encoding, callback) {
            this.push(String(buffer).replace(RE_ESCAPE, '').replace(/\r/g, '\n'));
            callback();
        },
    });
}

module.exports = stream_terminal_text;

};
modules["agent/src/agent_port_list"] = function (module, exports, require) {
const agent_shell = require('agent/src/agent_shell');

// What ss prints for one socket: the protocol, the state, the two queues, the address it is
// listening on, the peer column that a listener leaves empty, and — where this agent may see
// it — what is holding it
const RE_LINE = /^(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/;
// users:(("redis-server",pid=812,fd=6),("redis-server",pid=812,fd=7))
const RE_USER = /\("([^"]+)",pid=(\d+)/g;

// Every port this machine is listening on: tcp and udp, v4 and v6, numbers rather than the
// names in /etc/services. A socket another user owns is listed either way — its process is
// named only where the agent may look, which is its own sockets, or all of them when it is
// root.
async function agent_port_list()
{
    const answer = await agent_shell(['ss', '-tulpn']);
    if (answer.ok === false) {
        throw new Error(`ss: ${answer.stderr}`);
    }
    const items = [];
    for (const line of answer.stdout.split('\n')) {
        const found = RE_LINE.exec(line.trim());
        if (found === null || found[1] === 'Netid') {
            continue;
        }
        const local = address_split(found[5]);
        items.push({
            proto: found[1],
            port: local.port,
            address: local.address,
            state: found[2],
            users: users_from_text(found[7]),
        });
    }
    // By port, so the same number over tcp and udp, or over v4 and v6, stands together
    items.sort((a, b) => (a.port === b.port ? a.proto.localeCompare(b.proto) : a.port - b.port));
    return {at: Date.now(), items};
}

// `0.0.0.0:80`, `[::]:80`, `*:68`, `[fe80::1]%eth0:546` — the port is what follows the last
// colon, and the brackets around a v6 address are ss's, not the address's
function address_split(text)
{
    const at = text.lastIndexOf(':');
    const address = text.slice(0, at);
    return {
        address: (address.startsWith('[') && address.includes(']') ? address.slice(1, address.indexOf(']')) : address),
        // `*` where ss has no number to print, which is a socket bound to nothing
        port: parseInt(text.slice(at + 1), 10) || 0,
    };
}

function users_from_text(text)
{
    const out = [];
    for (const found of text.matchAll(RE_USER)) {
        out.push({pid: parseInt(found[2], 10), name: found[1]});
    }
    return out;
}

module.exports = agent_port_list;

};
modules["agent/src/agent_root_socket"] = function (module, exports, require) {
const DEFAULT_SOCKET = '/run/serviceman-root.sock';

// Where the root half of this machine answers. It is a file, and who may open it is who may
// ask for root work — which is the whole of the permission, kept by the filesystem.
function agent_root_socket(options)
{
    if (options !== undefined && options.root_socket !== undefined && options.root_socket !== '') {
        return options.root_socket;
    }
    return DEFAULT_SOCKET;
}

module.exports = agent_root_socket;

};
modules["agent/src/agent_serve"] = function (module, exports, require) {
const agent_apt = require('agent/src/agent_apt');
const agent_built = require('agent/src/agent_built');
const agent_dir_create = require('agent/src/agent_dir_create');
const agent_disk_list = require('agent/src/agent_disk_list');
const agent_doors_set = require('agent/src/agent_doors_set');
const agent_doors_state = require('agent/src/agent_doors_state');
const agent_fs_delete = require('agent/src/agent_fs_delete');
const agent_fs_list = require('agent/src/agent_fs_list');
const agent_fs_rename = require('agent/src/agent_fs_rename');
const agent_fs_stat = require('agent/src/agent_fs_stat');
const agent_link = require('agent/src/agent_link');
const agent_logline = require('agent/src/agent_logline');
const agent_logline_set = require('agent/src/agent_logline_set');
const agent_package_list = require('agent/src/agent_package_list');
const agent_port_list = require('agent/src/agent_port_list');
const agent_proc_list = require('agent/src/agent_proc_list');
const agent_program_docker_start = require('agent/src/agent_program_docker_start');
const agent_program_install = require('agent/src/agent_program_install');
const agent_program_logs = require('agent/src/agent_program_logs');
const agent_program_probe = require('agent/src/agent_program_probe');
const agent_program_remove = require('agent/src/agent_program_remove');
const agent_program_start = require('agent/src/agent_program_start');
const agent_program_step = require('agent/src/agent_program_step');
const agent_program_stop = require('agent/src/agent_program_stop');
const agent_resources = require('agent/src/agent_resources');
const agent_root_current = require('agent/src/agent_root_current');
const agent_root_or = require('agent/src/agent_root_or');
const agent_say = require('agent/src/agent_say');
const agent_screenshot = require('agent/src/agent_screenshot');
const agent_secrets_put = require('agent/src/agent_secrets_put');
const agent_shell = require('agent/src/agent_shell');
const agent_stats = require('agent/src/agent_stats');
const agent_tunnel = require('agent/src/agent_tunnel');
const agent_update = require('agent/src/agent_update');
const format_seconds = require('helpers/format_seconds');
const last_line = require('helpers/last_line');
const link_read = require('helpers/link_read');
const link_send = require('helpers/link_send');
const link_send_message = require('helpers/link_send_message');
const log_uid = require('helpers/log_uid');
const log_words = require('helpers/log_words');
const package_json = require('../package.json');
const shell_pty_argv = require('helpers/shell_pty_argv');
const shell_stream = require('helpers/shell_stream');

const AGENT_VERSION = package_json.version;
// How often the machine says its numbers again, and what it can be asked for now. The env
// name is for a test that cannot wait half a minute for a machine to change under it.
const STATS_EVERY_MS = parseInt(process.env.SERVICEMAN_STATS_MS || '30000', 10);
// And how often it says nothing more than "still here". Being alive is the machine's own to
// report: a host that has heard this has no reason to ask anything.
const BEAT_EVERY_MS = parseInt(process.env.SERVICEMAN_BEAT_MS || '10000', 10);
// One clock drives both: every second it looks at what is due and sends it. A tick that
// itself runs half a minute late is a machine that slept, and a link that was slept on is not
// trusted: the fresh dial is the ping the host can see.
const TICK_MS = 1000;
const SLEPT_MS = 30000;
// The host answers every beat with one of its own, so a link that carries nothing from the
// host for this long is not a link: a proxy in front may hold it half-open
// for as long as it likes, and the only way to find out is to hang up and dial again. The env
// name is for a test that cannot wait a minute and a half.
const HOST_GONE_MS = parseInt(process.env.SERVICEMAN_HOST_GONE_MS || '90000', 10);

const TUNNEL_KINDS = ['o', 'd', 'e', 'x', 'r'];

// What the host asks for every half minute, and every time it measures the link. These would
// bury everything worth reading, so they are done quietly.
const QUIET = ['ping', 'stats', 'resources', 'shell_resize', 'fs_list', 'fs_stat', 'proc_list', 'port_list', 'disk_list', 'package_list'];

// The work worth bracketing: a line that fetches a repo, an image that has to come down, a
// shell line somebody wrote. It takes seconds, so a reader wants to see it start and wait.
// Everything else is done and over before the next line is written, and takes one line.
const SLOW = ['apt_upgrade', 'docker', 'program_install', 'program_step'];

// The whole life of one link: say what this machine is, then do what serviceman asks
// until the link drops
async function agent_serve(options, socket, group, status)
{
    // Listened for before anything is awaited: a link that drops while the hello is being put
    // together would otherwise close unheard, and the agent would wait on a dead link for good
    const closed = new Promise(function (resolve) {
        socket.once('close', resolve);
    });
    socket.on('error', function (error) {
        agent_say(group, 'agent_link_error', {reason: error.message});
    });
    // serviceman hung up: the same half-open socket, and without this the agent would wait for
    // orders that can never come instead of dialling again
    socket.on('end', function () {
        socket.destroy();
    });
    // From here on, everything this agent says is also said to the host
    agent_link(socket);
    const resources = await agent_resources(options);
    link_send_message(socket, {
        type: 'hello',
        agent: AGENT_VERSION,
        built: agent_built,
        resources,
        stats: await agent_stats(options),
    });
    // The stream numbers this machine may open start at 1 and step by two: the host takes the
    // even ones, so neither end ever chooses a number the other is using
    const state = {link: socket, streams: {}, programs: {}, next_stream_id: -1, heard_at: Date.now()};
    // The status file reads the same object the methods write to, so what it says about the
    // programs on this machine is what is running, not a copy of what once was
    if (status !== undefined) {
        status.programs = state.programs;
    }
    // The link's one clock: the beat and the stats go when their time comes. A tick that
    // itself ran half a minute late means the machine slept; the slept-on link is closed and
    // dialled fresh.
    let tick_at = Date.now();
    let beat_at = tick_at + BEAT_EVERY_MS;
    let stats_at = tick_at + STATS_EVERY_MS;
    function tick() {
        const now = Date.now();
        const late = now - tick_at;
        tick_at = now;
        if (late >= SLEPT_MS) {
            agent_say(group, 'agent_woke', {slept: format_seconds(late), then: 'dialling fresh'});
            socket.destroy();
            return;
        }
        if (now - state.heard_at >= HOST_GONE_MS) {
            agent_say(group, 'agent_host_quiet', {silent: format_seconds(now - state.heard_at), then: 'dialling fresh'});
            socket.destroy();
            return;
        }
        if (now >= beat_at) {
            beat_at = now + BEAT_EVERY_MS;
            try {
                link_send_message(socket, {type: 'beat'});
            }
            catch {
                // The link is gone; the close is what says so
            }
        }
        if (now >= stats_at) {
            stats_at = now + STATS_EVERY_MS;
            stats_send(options, socket, group);
        }
    }
    const clock = setInterval(tick, TICK_MS);
    // The way in for whatever stands in front of this machine, open for as long as the link is
    // What the door cannot route itself goes over this link while it is up
    agent_doors_state.link = state;
    link_read(socket, function (kind, body) {
        try {
            frame_read(options, state, kind, body, group);
        }
        catch (error) {
            agent_say(group, 'agent_frame_error', {reason: error.message, then: 'the agent closes the link'});
            socket.destroy();
        }
    });
    await closed;
    agent_link(null);
    clearInterval(clock);
    if (agent_doors_state.link === state) {
        agent_doors_state.link = null;
    }
    streams_drop(state);
}

function frame_read(options, state, kind, body, group)
{
    // Anything arriving is the host saying it is there, whatever else it says
    state.heard_at = Date.now();
    if (TUNNEL_KINDS.includes(kind)) {
        agent_tunnel(state, kind, body);
        return;
    }
    if (kind === 'b') {
        link_send(state.link, 'b', body);
        return;
    }
    if (kind !== 'm') {
        agent_say(group, 'agent_frame_unknown', {kind});
        return;
    }
    const message = JSON.parse(body.toString('utf8'));
    if (message.type === 'beat') {
        // The host's answer to a beat: it is there, and the time it said so is written above
        return;
    }
    if (message.type === 'bye') {
        // The host is dropping this link and says so — a machine taken out of the config, a
        // definition that changed. Waiting for the drop to arrive through whatever is in front
        // could take minutes; hanging up now takes none, and the next dial says what is what.
        agent_say(group, 'agent_link_told', {reason: String(message.reason || ''), then: 'dialling fresh'});
        state.link.destroy();
        return;
    }
    if (message.type !== 'call') {
        agent_say(group, 'agent_message_unknown', {type: String(message.type)});
        return;
    }
    call_run(options, state, state.link, message, group);
}

// The link's one clock: the beat and the stats go when their time comes. A tick that itself
// ran half a minute late means the machine slept; the slept-on link is closed and dialled fresh.
function tick(options, state, socket, group)
{
    const now = Date.now();
    const late = now - state.tick_at;
    state.tick_at = now;
    if (late >= SLEPT_MS) {
        agent_say(group, 'agent_woke', {slept: format_seconds(late), then: 'dialling fresh'});
        socket.destroy();
        return;
    }
    if (now >= state.beat_at) {
        state.beat_at = now + BEAT_EVERY_MS;
        try {
            link_send_message(socket, {type: 'beat'});
        }
        catch {
            // The link is gone; the close is what says so
        }
    }
    if (now >= state.stats_at) {
        state.stats_at = now + STATS_EVERY_MS;
        stats_send(options, socket, group);
    }
}

// A link that drops takes every stream through it with it; the sockets on this machine close
function streams_drop(state)
{
    for (const id of Object.keys(state.streams)) {
        state.streams[id].socket.destroy();
    }
    state.streams = {};
}

// One thing the host asked for, and what came of it — so the machine itself says what was done
// to it, not only the host.
//
// Work that takes seconds gets a group of its own under the link, and is bracketed: begin now,
// end when it is over. Work that is done before the next line is written gets one line. A
// group for a single call is a uid that never appears twice, which is no group at all.
function call_run(options, state, socket, message, group)
{
    const at = Date.now();
    // A look is a question, not work: the host asks what an install would do before it asks
    // for it to be done, and a question that changes nothing has nothing to say
    const params = (message.params === undefined || message.params === null ? {} : message.params);
    // A docker command is loud only when the host names the service somebody is waiting on —
    // a run, a start, a pull. The rest are questions: an inspect, a port, the logs a pane
    // reads every two seconds, and every line those print would be a log of the log.
    const loud = QUIET.includes(message.method) === false && params.look !== true && (message.method !== 'docker' || typeof params.service === 'string');
    const slow = SLOW.includes(message.method);
    const call = (slow ? log_uid() : group);
    if (loud && slow) {
        agent_say(call, 'group_spawn', {parent: group});
        agent_say(call, 'agent_call_begin', Object.assign({method: message.method}, asked_words(message)));
    }
    // Every line a command prints goes out as it is printed, under the group of the call that
    // caused it — a blob at the end is not a log of what happened, it is a receipt
    function say(stream, text) {
        // What the command printed, as it printed it. The sender says which stream it is and
        // the group says which work — repeating the method on every line says nothing new.
        agent_say(call, (stream === 'stdout' ? 'agent_call_stdout' : 'agent_call_stderr'), text, params.service);
    }
    const promise = method_run(options, state, message.method, message.params, (loud ? say : undefined), call);
    promise.then(function (value) {
        if (loud) {
            // A command that failed is a value here, not an exception — so the answer decides
            // which line this is. `ok=true` beside a sender that already says ok is nothing.
            const failed = (value !== null && value !== undefined && value.ok === false);
            agent_say(call, sender_of(slow, failed), end_words(message, value, slow, failed, Date.now() - at));
        }
        link_send_message(socket, {type: 'reply', id: message.id, ok: true, value});
    }, function (error) {
        const words = (slow
            ? `${format_seconds(Date.now() - at)} ${error.message}`
            : Object.assign({method: message.method}, asked_words(message), {reason: error.message, took: format_seconds(Date.now() - at)}));
        agent_say(call, (slow ? 'agent_call_end_error' : 'agent_call_error'), words);
        link_send_message(socket, {type: 'reply', id: message.id, ok: false, error: error.message});
    });
}

// The line that ends a piece of work says what came of it and how long it took, and nothing
// that the line which began it already said: the group is the same, so the method, the machine
// and the command are all one line up.
function end_words(message, value, slow, failed, ms)
{
    const time = format_seconds(ms);
    if (slow === false) {
        return Object.assign(
            {method: message.method},
            asked_words(message),
            answered_words(message, value),
            (failed ? {reason: last_line(value.stderr)} : {}),
            {took: time}
        );
    }
    const answered = log_words(answered_words(message, value));
    const said = [time, answered, (failed ? last_line(value.stderr) : '')].filter(v => v !== '');
    return said.join(' ');
}

function sender_of(slow, failed)
{
    if (slow) {
        return (failed ? 'agent_call_end_error' : 'agent_call_end_ok');
    }
    return (failed ? 'agent_call_error' : 'agent_call_ok');
}

// The part of the question worth reading back: what was run, where, and for which service
function asked_words(message)
{
    const params = (message.params === undefined || message.params === null ? {} : message.params);
    if (message.method === 'docker') {
        return {argv: (params.argv === undefined ? '' : params.argv.join(' '))};
    }
    if (message.method === 'dir_create') {
        return {path: params.path};
    }
    if (message.method === 'fs_rename') {
        return {from: params.from, to: params.to};
    }
    if (message.method === 'fs_delete') {
        return {path: params.path};
    }
    if (message.method === 'program_step') {
        return {cwd: params.cwd, line: params.line};
    }
    if (message.method === 'program_install') {
        return {cwd: params.cwd, line: params.install};
    }
    if (message.method === 'program_start') {
        return {service: params.name, slot: params.slot, cwd: params.cwd, argv: (params.argv === undefined ? '' : params.argv.join(' '))};
    }
    if (message.method === 'program_stop' || message.method === 'program_probe') {
        return {service: params.name, slot: params.slot};
    }
    if (message.method === 'program_remove') {
        return {cwd: params.cwd};
    }
    return {};
}

// And the part of the answer worth reading back
function answered_words(message, value)
{
    const answer = (value === undefined || value === null ? {} : value);
    if (message.method === 'program_start') {
        return {pid: answer.pid, started: answer.started};
    }
    if (message.method === 'program_install') {
        return {step: answer.step};
    }
    if (message.method === 'program_remove') {
        return {removed: answer.removed};
    }
    if (message.method === 'program_probe') {
        return {running: answer.running};
    }
    return {};
}

async function method_run(options, state, method, params, say, group)
{
    if (method === 'ping') {
        return {at: Date.now()};
    }
    if (method === 'stats') {
        return await agent_stats(options);
    }
    if (method === 'resources') {
        return await agent_resources(options);
    }
    if (method === 'docker') {
        const line = [options.docker].concat(params.argv);
        // A pull the host is showing to somebody: docker only draws its progress for a
        // terminal, so it is given one
        return await shell_stream((params.pty === true ? shell_pty_argv(line) : line), {}, say);
    }
    if (method === 'dir_create') {
        return await agent_dir_create(params.path);
    }
    if (method === 'fs_list') {
        return await agent_fs_list(params.path);
    }
    if (method === 'proc_list') {
        return await agent_proc_list();
    }
    if (method === 'disk_list') {
        return await agent_disk_list();
    }
    if (method === 'package_list') {
        return await agent_package_list(options);
    }
    if (method === 'port_list') {
        // Read as root where this machine has a root half, because that is the difference
        // between a port with a name beside it and a port with an empty column; asked here,
        // as the agent's own user, where it has none
        return await agent_root_or(options, 'port_list', {}, undefined, () => agent_port_list());
    }
    if (method === 'fs_rename') {
        return await agent_fs_rename(params);
    }
    if (method === 'fs_stat') {
        return await agent_fs_stat(params);
    }
    if (method === 'fs_delete') {
        return await agent_fs_delete(params);
    }
    if (method === 'screenshot') {
        return await agent_screenshot(options);
    }
    if (method === 'apt_upgrade') {
        // The root half of this machine does it where there is one; here, with sudo, where
        // there is not
        return await agent_root_or(options, 'apt_upgrade', {}, say, () => agent_apt(state, options, say));
    }
    if (method === 'apt_cancel') {
        return await agent_root_or(options, 'apt_cancel', {}, undefined, () => agent_apt.cancel(state));
    }
    if (method === 'shell_resize') {
        const found = state.streams[params.id];
        if (found !== undefined && typeof found.socket.resize === 'function') {
            found.socket.resize(params.cols, params.rows);
        }
        return {};
    }
    if (method === 'program_install') {
        return await agent_program_install(options, params, say);
    }
    if (method === 'program_remove') {
        return await agent_program_remove(params);
    }
    if (method === 'program_step') {
        return await agent_program_step(options, params, say);
    }
    if (method === 'secrets_put') {
        return agent_secrets_put(params);
    }
    if (method === 'program_docker_start') {
        return await agent_program_docker_start(options, params, say);
    }
    if (method === 'program_start') {
        return agent_program_start(state, params, group);
    }
    if (method === 'program_stop') {
        return await agent_program_stop(state, params, group);
    }
    if (method === 'doors_set') {
        return agent_doors_set(params.table);
    }
    if (method === 'logline_set') {
        const out = agent_logline_set(params);
        // Collection follows the new word at once; it does not wait for the answer to leave
        agent_logline(options);
        return out;
    }
    if (method === 'update') {
        return agent_update(params, group);
    }
    if (method === 'program_logs') {
        return agent_program_logs(state, params);
    }
    if (method === 'program_probe') {
        return agent_program_probe(state, params);
    }
    throw new Error(`this agent knows nothing called ${JSON.stringify(String(method))}`);
}

function stats_send(options, socket, group)
{
    // The same beat carries the one thing the root half cannot notice by itself: that the file
    // it runs from has been replaced
    agent_root_current(options, group).catch(function (error) {
        agent_say(group, 'root_update_error', {reason: error.message});
    });
    const promise = agent_stats(options);
    promise.then(function (stats) {
        link_send_message(socket, {type: 'stats', stats});
    }, function (error) {
        agent_say(group, 'agent_stats_error', {reason: error.message});
    });
}

module.exports = agent_serve;

};
modules["agent/src/agent_dir_create"] = function (module, exports, require) {
const fs = require('fs');

// A bind mount whose folder is missing would be made by docker as root; the agent makes it first
async function agent_dir_create(dir)
{
    if (fs.existsSync(dir)) {
        return {created: false};
    }
    await fs.promises.mkdir(dir, {recursive: true});
    return {created: true};
}

module.exports = agent_dir_create;

};
modules["agent/src/agent_disk_list"] = function (module, exports, require) {
const agent_shell = require('agent/src/agent_shell');
const disk_list_from_df = require('agent/src/disk_list_from_df');

// Every filesystem this machine has mounted: how much room each has, and how many files it
// may still hold — a disk can be full of inodes with space to spare, and then nothing new
// can be written to it at all
async function agent_disk_list()
{
    const space = await agent_shell(['df', '-PkT']);
    if (space.ok === false) {
        throw new Error(`df: ${space.stderr}`);
    }
    // A df that cannot count inodes still says how much room there is
    const inodes = await agent_shell(['df', '-PiT']);
    return {at: Date.now(), items: disk_list_from_df(space.stdout, inodes.ok ? inodes.stdout : '')};
}

module.exports = agent_disk_list;

};
modules["agent/src/disk_list_from_df"] = function (module, exports, require) {
const BLOCK_BYTES = 1024;

// `df -PkT` and `df -PiT` text -> one row per disk, space and inodes side by side, and a row
// for everything else mounted, marked as not being a disk, for the page to show when asked.
//
// A disk is a block device; one mounted in several places — a bind mount, a subvolume — is
// one row naming every place. A ZFS pool is a disk too, though df names it by its datasets —
// rpool/ROOT/ubuntu on /, rpool/USERDATA on /home — and never by a device: the datasets are
// one row, what they use added up, and the room left is the pool's, which each of them
// reports the same. tmpfs, overlay and a snap's loop image are not disks.
//
// Ubuntu's encrypted ZFS keeps the pool's key on a small volume of its own,
// /dev/mapper/keystore-<pool>: that pool is marked encrypted, and the volume as its key.
function disk_list_from_df(space_text, inode_text)
{
    const inodes_by_mount = {};
    for (const row of df_rows(inode_text)) {
        inodes_by_mount[row.mount] = row;
    }
    const out = [];
    const disk_by_key = {};
    for (const row of df_rows(space_text)) {
        const zfs = (row.type === 'zfs');
        const disk = zfs || (row.device.startsWith('/dev/') && row.device.startsWith('/dev/loop') === false);
        const inodes = inodes_by_mount[row.mount];
        // A filesystem that keeps no inode count — vfat, among others — says 0
        const counted = (inodes !== undefined && inodes.total > 0);
        const key = (zfs ? `zfs ${row.device.split('/')[0]}` : row.device);
        const found = (disk ? disk_by_key[key] : undefined);
        if (found !== undefined) {
            found.mounts.push(row.mount);
            if (zfs) {
                found.used += row.used*BLOCK_BYTES;
                found.free = Math.max(found.free, row.free*BLOCK_BYTES);
                found.total = found.used + found.free;
                if (counted) {
                    found.inodes_used = (found.inodes_used || 0) + inodes.used;
                    found.inodes_free = Math.max(found.inodes_free || 0, inodes.free);
                    found.inodes_total = found.inodes_used + found.inodes_free;
                }
            }
            continue;
        }
        const item = {
            device: (zfs ? row.device.split('/')[0] : row.device),
            type: row.type,
            mounts: [row.mount],
            disk,
            total: (zfs ? (row.used + row.free)*BLOCK_BYTES : row.total*BLOCK_BYTES),
            used: row.used*BLOCK_BYTES,
            free: row.free*BLOCK_BYTES,
            inodes_total: (counted ? (zfs ? inodes.used + inodes.free : inodes.total) : null),
            inodes_used: (counted ? inodes.used : null),
            inodes_free: (counted ? inodes.free : null),
            encrypted: false,
            // The pool this volume holds the key of, or null
            key_of: null,
        };
        if (disk) {
            disk_by_key[key] = item;
        }
        out.push(item);
    }
    for (const item of out) {
        const found = /^\/dev\/mapper\/keystore-(.+)$/.exec(item.device);
        const pool = (found === null ? undefined : disk_by_key[`zfs ${found[1]}`]);
        if (pool !== undefined) {
            pool.encrypted = true;
            item.key_of = pool.device;
        }
    }
    // A pool mounted at / is read by its root first
    for (const item of out) {
        const at = item.mounts.indexOf('/');
        if (at > 0) {
            item.mounts.splice(at, 1);
            item.mounts.unshift('/');
        }
    }
    // The disks first, then the rest, each by where it is mounted
    out.sort((a, b) => (a.disk === b.disk ? a.mounts[0].localeCompare(b.mounts[0]) : (a.disk ? -1 : 1)));
    return out;
}

// The lines of df as fields. With -T the type is the second column; a mount point may hold
// spaces, so it is the rest of the line.
function df_rows(text)
{
    const out = [];
    for (const line of text.split('\n').slice(1)) {
        const columns = line.trim().split(/\s+/);
        if (columns.length < 7) {
            continue;
        }
        out.push({
            device: columns[0],
            type: columns[1],
            total: parseInt(columns[2], 10) || 0,
            used: parseInt(columns[3], 10) || 0,
            free: parseInt(columns[4], 10) || 0,
            mount: columns.slice(6).join(' '),
        });
    }
    return out;
}

module.exports = disk_list_from_df;

};
modules["agent/src/agent_doors_set"] = function (module, exports, require) {
const agent_doors_path = require('agent/src/agent_doors_path');
const agent_doors_state = require('agent/src/agent_doors_state');
const file_write_synced = require('agent/src/file_write_synced');

// A new door table from serviceman: on disk first, whole or not at all, and only then what the
// door routes by. It holds the tokens the machines ask each other with, so nobody else reads it.
function agent_doors_set(table)
{
    file_write_synced(agent_doors_path(), JSON.stringify(table, null, 4), 0o600);
    agent_doors_state.table = table;
    return {version: table.version};
}

module.exports = agent_doors_set;

};
modules["agent/src/agent_fs_delete"] = function (module, exports, require) {
const agent_fs_path = require('agent/src/agent_fs_path');
const fs = require('fs');
const os = require('os');

// A file or a whole folder, taken away for good. The home of the agent's user and the root
// of the disk are not things a file manager deletes.
async function agent_fs_delete(params)
{
    const full = agent_fs_path(params.path);
    if (full === '/' || full === os.homedir()) {
        throw new Error(`${full} is not a thing the File Manager deletes`);
    }
    await fs.promises.rm(full, {recursive: true});
    return {};
}

module.exports = agent_fs_delete;

};
modules["agent/src/agent_fs_list"] = function (module, exports, require) {
const agent_fs_path = require('agent/src/agent_fs_path');
const fs = require('fs');
const path = require('path');

// One folder of this machine, read as the agent's own user: what that user may not open,
// this cannot show. Folders first, then files, each half by name.
async function agent_fs_list(asked)
{
    const dir = agent_fs_path(asked);
    const found = await fs.promises.readdir(dir, {withFileTypes: true});
    const items = [];
    for (const entry of found) {
        const item = {name: entry.name, kind: (entry.isDirectory() ? 'dir' : 'file'), size: null, mtime_ms: null};
        // The stat follows a link, so a link to a folder opens like one; a name that cannot
        // be read stays in the list with nothing said about it
        try {
            const stat = await fs.promises.stat(path.join(dir, entry.name));
            item.kind = (stat.isDirectory() ? 'dir' : 'file');
            item.size = (stat.isFile() ? stat.size : null);
            item.mtime_ms = Math.round(stat.mtimeMs);
        }
        catch {
        }
        items.push(item);
    }
    items.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : (a.kind === 'dir' ? -1 : 1)));
    return {path: dir, items};
}

module.exports = agent_fs_list;

};
modules["agent/src/agent_fs_rename"] = function (module, exports, require) {
const agent_fs_path = require('agent/src/agent_fs_path');
const fs = require('fs');

// One name carried to another — another folder included, which is what moving is. The same
// disk carries it in one step; another disk refuses, and the refusal is the answer.
async function agent_fs_rename(params)
{
    await fs.promises.rename(agent_fs_path(params.from), agent_fs_path(params.to));
    return {};
}

module.exports = agent_fs_rename;

};
modules["agent/src/agent_fs_stat"] = function (module, exports, require) {
const agent_fs_path = require('agent/src/agent_fs_path');
const fs = require('fs');

// One name, weighed before it is served: folder or file, how big, how old
async function agent_fs_stat(params)
{
    const stat = await fs.promises.stat(agent_fs_path(params.path));
    return {kind: (stat.isDirectory() ? 'dir' : 'file'), size: stat.size, mtime_ms: Math.round(stat.mtimeMs)};
}

module.exports = agent_fs_stat;

};
modules["agent/src/agent_logline_set"] = function (module, exports, require) {
const agent_logline_path = require('agent/src/agent_logline_path');
const agent_logline_read = require('agent/src/agent_logline_read');
const file_write_synced = require('agent/src/file_write_synced');

// serviceman says where this machine's lines go — {endpoint, token, logs: "all", dirs} — or
// that they go nowhere, {logs: "off"}. `dirs` are the folders whose files are read besides the
// containers: [{path, service}]. It is on disk before anything acts on it: after a restart the
// agent starts from this file, so a machine whose serviceman is away still ships to the
// endpoint it last heard of.
//
// The floor is the moment collection was switched on. Every line from it on is kept; a telling
// that changes only the endpoint or the token keeps the floor where it is. Switched off and on
// again, the floor is the new moment.
function agent_logline_set(params)
{
    const logs = (params !== undefined && params.logs === 'all' ? 'all' : 'off');
    if (logs === 'all' && (typeof params.endpoint !== 'string' || typeof params.token !== 'string')) {
        throw new Error('logs "all" needs an endpoint and a token');
    }
    const was = agent_logline_read();
    const out = {
        endpoint: (logs === 'all' ? params.endpoint : null),
        token: (logs === 'all' ? params.token : null),
        logs,
        floor: (logs === 'off' ? null : (was.logs === 'all' && was.floor !== null ? was.floor : new Date().toISOString())),
        dirs: (logs === 'all' && Array.isArray(params.dirs) ? params.dirs.map(v => ({path: String(v.path), service: (v.service === undefined || v.service === null ? null : String(v.service))})) : []),
    };
    if (JSON.stringify(out) !== JSON.stringify(was)) {
        // Mode 600: the token lets this machine write to the log
        file_write_synced(agent_logline_path('settings.json'), `${JSON.stringify(out, null, 4)}\n`);
    }
    return {logs: out.logs, floor: out.floor};
}

module.exports = agent_logline_set;

};
modules["agent/src/agent_package_list"] = function (module, exports, require) {
const agent_apt_binary = require('agent/src/agent_apt_binary');
const agent_shell = require('agent/src/agent_shell');
const package_list_from_dpkg = require('agent/src/package_list_from_dpkg');

const FORMAT = '${db:Status-Abbrev}\t${Package}\t${Architecture}\t${Version}\t${Installed-Size}\t${Section}\t${binary:Summary}\n';

// Every package dpkg has installed on this machine: which were asked for by name and which
// came along as something else's need, which are held, and which an upgrade would move on.
// None of it needs root; the dry run reads the lists the last `apt-get update` left.
async function agent_package_list(options)
{
    const status = await agent_shell(['dpkg-query', '-W', '-f', FORMAT]);
    if (status.ok === false) {
        throw new Error(/ENOENT/.test(status.stderr) ? 'this machine has no dpkg: it is not a Debian or an Ubuntu' : `dpkg-query: ${status.stderr}`);
    }
    const all = await Promise.all([
        agent_shell(['apt-mark', 'showmanual']),
        agent_shell(['apt-mark', 'showhold']),
        agent_shell([agent_apt_binary(options), '-s', 'upgrade']),
    ]);
    const items = package_list_from_dpkg(status.stdout, all[0].stdout, all[1].stdout, all[2].ok ? all[2].stdout : '');
    // Without apt-mark every package would read as a dependency, and without the dry run as
    // up to date: the page says which of the two it could not tell
    return {at: Date.now(), items, manual_known: all[0].ok, updates_known: all[2].ok};
}

module.exports = agent_package_list;

};
modules["agent/src/package_list_from_dpkg"] = function (module, exports, require) {
const KIB = 1024;

// What dpkg, apt-mark and a dry-run upgrade say -> one row per installed package, by name.
// A package of a second architecture, libc6:i386 beside libc6, is a row of its own.
//
// Status is dpkg's three letters: wanted, state, error. "ii " is installed and well, "hi " the
// same and held; "rc " is removed with its config left behind, which is not installed and is
// left out; any other state or an error letter is a package caught half way, marked so.
function package_list_from_dpkg(status_text, manual_text, hold_text, upgrade_text)
{
    const manual = new Set(lines_of(manual_text));
    const held = new Set(lines_of(hold_text));
    const updates = updates_from_apt(upgrade_text);
    const out = [];
    for (const line of lines_of(status_text)) {
        const columns = line.split('\t');
        if (columns.length < 7) {
            continue;
        }
        const status = columns[0];
        if (status[1] === 'n' || status[1] === 'c') {
            continue;
        }
        const name = columns[1];
        const arch = columns[2];
        const size = parseInt(columns[4], 10);
        out.push({
            name,
            arch,
            version: columns[3],
            size: (Number.isFinite(size) ? size*KIB : null),
            section: columns[5],
            summary: columns.slice(6).join('\t'),
            manual: (manual.has(name) || manual.has(`${name}:${arch}`)),
            held: (held.has(name) || held.has(`${name}:${arch}`)),
            broken: (status[1] !== 'i' || (status[2] || ' ') !== ' '),
            update: updates[`${name}:${arch}`] || updates[name] || null,
        });
    }
    out.sort((a, b) => (a.name === b.name ? cmp(a.arch, b.arch) : cmp(a.name, b.name)));
    return out;
}

// "Inst libssl3 [3.0.2-0ubuntu1.15] (3.0.2-0ubuntu1.18 Ubuntu:22.04/jammy-security [amd64])"
// -> the version it would become, and whether a security archive is where it comes from
function updates_from_apt(text)
{
    const out = {};
    for (const line of lines_of(text)) {
        const found = /^Inst (\S+?)(?::\S+)? (?:\[\S+\] )?\((\S+) (.*?) \[(\S+)\]\)/.exec(line);
        if (found === null) {
            continue;
        }
        const update = {version: found[2], security: /-security\b/.test(found[3])};
        out[`${found[1]}:${found[4]}`] = update;
        out[found[1]] = update;
    }
    return out;
}

function lines_of(text)
{
    return (text || '').split('\n').map(v => v.trim()).filter(v => v !== '');
}

// Package names are ascii, and the order apt itself lists them in
function cmp(a, b)
{
    return (a < b ? -1 : (a > b ? 1 : 0));
}

module.exports = package_list_from_dpkg;

};
modules["agent/src/agent_proc_list"] = function (module, exports, require) {
const agent_shell = require('agent/src/agent_shell');
const fs = require('fs');
const timers = require('timers/promises');

// The columns ps is asked for, in the order it prints them. The last one is the command line
// itself, spaces and all, so it takes whatever is left of the line.
const RE_LINE = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/;
const RSS_BLOCK_BYTES = 1024;
// How long cpu use is measured over: what top shows is a short window like this, not the
// average over a process's whole life that ps prints
const CPU_WINDOW_MS = 500;
const CLOCK_TICKS_DEFAULT = 100;

const clock = {ticks: null};

// Every process on this machine, not this agent's own: ps -e is the whole table, which is what
// a page showing a machine is for. The tree is left to whoever reads it — each process carries
// the pid of the one that started it, and that is all a tree needs.
//
// `cpu` is the share of one core each process used over the last half second, from the cpu
// time linux keeps for it in /proc; 100 is a whole core, so a process on several goes past
// it. Where there is no /proc it is what ps says, and `cpu_window_ms` is null to say so.
//
// `user:32` because the default width cuts a name at eight characters without saying so.
async function agent_proc_list()
{
    const before = cpu_ticks();
    if (before !== null) {
        await timers.setTimeout(CPU_WINDOW_MS);
    }
    const answer = await agent_shell(['ps', '-eo', 'pid=,ppid=,user:32=,pcpu=,pmem=,rss=,etimes=,stat=,args=']);
    if (answer.ok === false) {
        throw new Error(`ps: ${answer.stderr}`);
    }
    const after = cpu_ticks();
    const measured = (before !== null && after !== null);
    const ticks_per_second = (measured ? await clock_ticks() : CLOCK_TICKS_DEFAULT);
    const seconds = (measured ? Number(after.at - before.at)/1e9 : 0);
    const items = [];
    for (const line of answer.stdout.split('\n')) {
        const found = RE_LINE.exec(line);
        if (found === null) {
            continue;
        }
        const pid = parseInt(found[1], 10);
        const ppid = parseInt(found[2], 10);
        // The ps that made this list is not something the machine is running
        if (ppid === process.pid && found[9].startsWith('ps ')) {
            continue;
        }
        let cpu = parseFloat(found[4]);
        if (measured) {
            const was = before.ticks.get(pid);
            const now = after.ticks.get(pid);
            cpu = (was === undefined || now === undefined || seconds <= 0 ? 0 : Math.max(0, now - was)/ticks_per_second/seconds*100);
        }
        items.push({
            pid,
            ppid,
            user: found[3],
            cpu: Math.round(cpu*10)/10,
            mem: parseFloat(found[5]),
            rss: parseInt(found[6], 10)*RSS_BLOCK_BYTES,
            // How long it has been running, which is the one thing about a process that a
            // reader can compare without knowing the machine's clock
            elapsed_ms: parseInt(found[7], 10)*1000,
            state: found[8],
            command: found[9],
        });
    }
    return {at: Date.now(), cpu_window_ms: (measured ? Math.round(seconds*1000) : null), items};
}

// The cpu time of every process, user and system, in clock ticks; null where there is no /proc
function cpu_ticks()
{
    let names;
    try {
        names = fs.readdirSync('/proc');
    }
    catch {
        return null;
    }
    const at = process.hrtime.bigint();
    const ticks = new Map();
    for (const name of names) {
        if (/^\d+$/.test(name) === false) {
            continue;
        }
        try {
            // The command name in brackets may hold spaces and brackets of its own: the fields
            // are counted from the last closing one. utime and stime are the 14th and 15th.
            const text = fs.readFileSync(`/proc/${name}/stat`, 'utf8');
            const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
            ticks.set(parseInt(name, 10), parseInt(fields[11], 10) + parseInt(fields[12], 10));
        }
        catch {
            // It ended between the listing and the reading
        }
    }
    return (ticks.size === 0 ? null : {at, ticks});
}

// How many ticks a second of cpu time is: 100 nearly everywhere, and asked once
async function clock_ticks()
{
    if (clock.ticks === null) {
        const answer = await agent_shell(['getconf', 'CLK_TCK']);
        const value = parseInt(answer.stdout, 10);
        clock.ticks = (answer.ok && value > 0 ? value : CLOCK_TICKS_DEFAULT);
    }
    return clock.ticks;
}

module.exports = agent_proc_list;

};
modules["agent/src/agent_program_docker_start"] = function (module, exports, require) {
const agent_dir = require('agent/src/agent_dir');
const agent_services_dir = require('agent/src/agent_services_dir');
const fs = require('fs');
const path = require('path');
const program_docker_argv = require('helpers/program_docker_argv');
const shell_stream = require('helpers/shell_stream');

// Starts the container a shell service runs in. The host knows the service; this end knows
// where its folder is, and a bind mount is a path on the machine that runs docker.
function agent_program_docker_start(options, params, say)
{
    const dir = path.resolve(agent_services_dir(), params.cwd);
    // What it keeps has to be there before the container is, or docker makes it as root
    for (const volume of (params.volumes === undefined ? [] : params.volumes)) {
        if (volume.kind === 'kept') {
            fs.mkdirSync(path.join(agent_dir(), 'data', volume.keep), {recursive: true});
        }
    }
    return shell_stream([options.docker].concat(program_docker_argv(Object.assign({}, params, {dir, keep_root: agent_dir()}))), {}, say);
}

module.exports = agent_program_docker_start;

};
modules["agent/src/agent_services_dir"] = function (module, exports, require) {
const agent_dir = require('agent/src/agent_dir');
const path = require('path');

// Where everything the host asks this machine to install goes: one folder under the agent, so
// that taking the agent away takes its work with it and nothing is left anywhere else.
function agent_services_dir()
{
    if (process.env.SERVICEMAN_SERVICES_DIR) {
        return path.resolve(process.env.SERVICEMAN_SERVICES_DIR);
    }
    return path.join(agent_dir(), 'services');
}

module.exports = agent_services_dir;

};
modules["helpers/program_docker_argv"] = function (module, exports, require) {
// The container a shell service runs in when it names an image. The image is the environment,
// the folder is the program, the command is yours — and the name, the labels and the published
// port are what serviceman puts on every container it makes, so the same driver stops it and
// finds it again.
const program_user = require('helpers/program_user');
const secrets_mounts = require('helpers/secrets_mounts');
const volume_text = require('helpers/volume_text');

const INSIDE = '/app';
// Where docker publishes the program's port: the loopback of the machine that runs it, which is
// where the agent's tunnel reaches it
const PUBLISHED_AT = '127.0.0.1';

// What the program keeps: a folder of the agent's, a named volume of docker's, or a path on
// that machine — mounted where the program looks for it
function volume_mounts(volumes, keep_root)
{
    const out = [];
    for (const volume of (volumes === undefined || volumes === null ? [] : volumes)) {
        out.push('--volume', volume_text(volume, keep_root));
    }
    return out;
}

function program_docker_argv(params)
{
    const out = [
        'run', '-d',
        // An init as pid 1. A command that ends in `exec` makes the program itself pid 1 of the
        // container, and the kernel throws away every signal pid 1 has no handler for — so
        // `docker stop` waits out its whole timeout and kills it. With this, docker's own init
        // is pid 1, the program is its child with ordinary signal rules, and a stop takes
        // milliseconds. See notes/signals-through-a-process-chain.md.
        '--init',
        '--name', params.container,
        '--label', `serviceman.service=${params.service}`,
        '--label', `serviceman.spec=${params.spec}`,
        '--volume', `${params.dir}:${INSIDE}`,
        '--workdir', INSIDE,
    ].concat(program_user(params.user)).concat(secrets_mounts(params.secrets)).concat(volume_mounts(params.volumes, params.keep_root));
    if (params.port !== null && params.port !== undefined) {
        out.push('--publish', `${PUBLISHED_AT}::${params.port}`);
    }
    for (const name of Object.keys(params.env === undefined || params.env === null ? {} : params.env)) {
        out.push('--env', `${name}=${params.env[name]}`);
    }
    out.push(params.image, '/bin/sh', '-c', params.command);
    return out;
}

module.exports = program_docker_argv;

};
modules["helpers/program_user"] = function (module, exports, require) {
const INSIDE = '/app';

// Who a container of ours runs as. A container that writes into a mounted folder as root
// leaves a folder its owner cannot empty, cannot reinstall into and cannot take away — one
// `docker run` and the folder is out of reach.
//
// `user` on the service names one the image has: `node:node` in a node image. Without it, the
// user running the agent is used by number, which needs nothing of the image at all.
//
// HOME comes with it, because a tool that wants somewhere to cache — npm above all — reaches
// for /root otherwise, and that is not this user's to write either.
function program_user(user)
{
    if (user !== null && user !== undefined && user !== '') {
        return ['--user', user, '--env', `HOME=${INSIDE}`];
    }
    if (typeof process.getuid !== 'function') {
        return [];
    }
    return ['--user', `${process.getuid()}:${process.getgid()}`, '--env', `HOME=${INSIDE}`];
}

module.exports = program_user;

};
modules["helpers/secrets_mounts"] = function (module, exports, require) {
const INSIDE_FILE = '/run/serviceman/secrets.tsv';
const INSIDE_COMMAND = '/usr/local/bin/secrets';

// What a container needs to answer `secrets <name>`: the file, and the command that reads it.
// Both read-only, because nothing in there has any business writing either.
function secrets_mounts(secrets)
{
    if (secrets === null || secrets === undefined) {
        return [];
    }
    return [
        '--volume', `${secrets.tsv}:${INSIDE_FILE}:ro`,
        '--volume', `${secrets.script}:${INSIDE_COMMAND}:ro`,
    ];
}

module.exports = secrets_mounts;

};
modules["helpers/volume_text"] = function (module, exports, require) {
const path = require('path');

// One storage line as docker takes it. A path the service keeps is a folder under the folder
// of whoever runs it — the agent's own directory over there, serviceman's own here — so the
// machine that will run the container is the one that writes this line.
function volume_text(volume, keep_root)
{
    const source = (volume.kind === 'kept' ? path.join(keep_root === undefined ? '.' : keep_root, 'data', volume.keep) : volume.source);
    if (volume.readonly) {
        return `${source}:${volume.target}:ro`;
    }
    return `${source}:${volume.target}`;
}

module.exports = volume_text;

};
modules["helpers/shell_stream"] = function (module, exports, require) {
const child_process = require('child_process');
const stream = require('stream');
const stream_each = require('@vbarbarosh/node-helpers/src/stream_each');
const stream_lines = require('@vbarbarosh/node-helpers/src/stream_lines');
const stream_terminal_text = require('helpers/stream_terminal_text');

// What is kept for the caller, once the lines have been said. A `docker port` answer is one
// line and an `npm install` is a thousand; the last of them is what a reason is made of.
const KEEP_LINES = 200;

// Runs a command and says every line as it is printed, instead of holding all of it for the
// end. A line is worth reading the moment it is whole — that is when somebody watching the log
// wants it, not a minute later when the command finally stops.
function shell_stream(argv, options, say)
{
    const child = child_process.spawn(argv[0], argv.slice(1), Object.assign({stdio: ['ignore', 'pipe', 'pipe']}, options));
    const kept = {stdout: [], stderr: []};
    function read(name, source) {
        return stream.promises.pipeline(source, stream_terminal_text(), stream_lines(), stream_each(function (line) {
            kept[name].push(line);
            if (kept[name].length > KEEP_LINES) {
                kept[name].shift();
            }
            if (say !== undefined && say !== null && line.trim() !== '') {
                say(name, line);
            }
        }));
    }
    const done = new Promise(function (resolve) {
        child.once('error', function (error) {
            kept.stderr.push(error.message);
            resolve(-1);
        });
        child.once('close', function (code) {
            resolve(code);
        });
    });
    return Promise.all([done, read('stdout', child.stdout), read('stderr', child.stderr)]).then(function (all) {
        return {ok: all[0] === 0, code: all[0], stdout: kept.stdout.join('\n').trim(), stderr: kept.stderr.join('\n').trim()};
    });
}

module.exports = shell_stream;

};
modules["agent/src/agent_program_install"] = function (module, exports, require) {
const agent_services_dir = require('agent/src/agent_services_dir');
const path = require('path');
const program_install_here = require('helpers/program_install_here');

// The host asks this before it asks for the program to run. A folder written as a relative
// path is this machine's to place, and it places it under the agent's own services folder.
function agent_program_install(options, params, say)
{
    return program_install_here(path.resolve(agent_services_dir(), params.cwd), params.install, params.update, params.mark, params.env, params.look, params.made, params.image, options.docker, params.user, say, params.secrets, params.force);
}

module.exports = agent_program_install;

};
modules["helpers/program_install_here"] = function (module, exports, require) {
const fs = require('fs');
const path = require('path');
const program_line_argv = require('helpers/program_line_argv');
const secrets_env = require('helpers/secrets_env');
const shell_stream = require('helpers/shell_stream');

const MARK_FILE = '.serviceman-app';

// Puts a program's folder in place on this machine, and says whether it had to. It is the same work
// on the host and on a remote — the agent asks for this too — so the answer is a value here,
// never an exception: the caller decides what a failed install means.
async function program_install_here(dir, install, update, mark, env, look, made, image, docker_bin, user, say, secrets, force)
{
    fs.mkdirSync(dir, {recursive: true});
    const file = path.join(dir, MARK_FILE);
    const found = mark_read(file);
    if (install === null || install === undefined || (found === mark && force !== true)) {
        return {step: null, ok: true, stdout: '', stderr: ''};
    }
    // A folder that is already something gets the update line when there is one: the install
    // line is for an empty folder, and running it over a working copy is a different thing
    const step = (found === null || update === null || update === undefined ? 'install' : 'update');
    // Asked what it would do, and not to do it: the host says a line is about to run before it
    // runs, and says nothing at all when nothing needs running
    if (look === true) {
        return {step, ok: true, stdout: '', stderr: ''};
    }
    // An install line is written for an empty folder — `git clone .` says so itself — and half
    // of a failed install is worse than none of it: the next try would meet its own leftovers
    // and fail on those instead. So a folder serviceman made is emptied before the line runs
    // and taken away again if it fails. A folder somebody named is theirs, and is left alone.
    if (step === 'install' && made === true) {
        try {
            fs.rmSync(dir, {recursive: true, force: true});
        }
        catch (error) {
            return {step, ok: false, stdout: '', stderr: `${dir} cannot be emptied: ${error.message}. Something in it belongs to another user — a container that ran as root, most likely.`};
        }
        fs.mkdirSync(dir, {recursive: true});
    }
    const line = (step === 'install' ? install : update);
    const answer = await shell_stream(program_line_argv(line, dir, image, env, docker_bin, user, secrets), {
        cwd: dir,
        env: Object.assign({}, process.env, secrets_env(secrets), env || {}),
    }, say);
    if (answer.ok) {
        fs.writeFileSync(file, `${mark}\n`);
        return Object.assign({step}, answer);
    }
    if (step === 'install' && made === true) {
        try {
            fs.rmSync(dir, {recursive: true, force: true});
        }
        catch (error) {
            // The folder is out of reach — something in it belongs to somebody else. That is
            // worth saying, but the line that failed is still why we are here.
            answer.stderr = `${answer.stderr}\nthe folder could not be emptied afterwards: ${error.message}`;
        }
    }
    return Object.assign({step}, answer);
}

function mark_read(file)
{
    try {
        return fs.readFileSync(file, 'utf8').trim();
    }
    catch {
        return null;
    }
}

module.exports = program_install_here;

};
modules["helpers/program_line_argv"] = function (module, exports, require) {
// The command line for one line of a program's life. In a container when the service names an
// image — the folder is mounted at /app and the line runs there, so `npm install` needs npm in
// the image and nothing on the machine — and on the machine itself when it does not.
const program_user = require('helpers/program_user');
const secrets_mounts = require('helpers/secrets_mounts');

const INSIDE = '/app';

function program_line_argv(line, dir, image, env, docker_bin, user, secrets)
{
    if (image === null || image === undefined || image === '') {
        return ['/bin/sh', '-c', line];
    }
    const out = [(docker_bin === undefined ? 'docker' : docker_bin), 'run', '--rm', '--volume', `${dir}:${INSIDE}`, '--workdir', INSIDE].concat(program_user(user)).concat(secrets_mounts(secrets));
    for (const name of Object.keys(env === undefined || env === null ? {} : env)) {
        out.push('--env', `${name}=${env[name]}`);
    }
    out.push(image, '/bin/sh', '-c', line);
    return out;
}

module.exports = program_line_argv;

};
modules["helpers/secrets_env"] = function (module, exports, require) {
const path = require('path');

// How a program finds `secrets` when it runs on the machine itself: the command is first on its
// PATH, and the file it reads is named. In a container both are mounted where the command
// already looks, so nothing has to be said.
function secrets_env(secrets)
{
    if (secrets === null || secrets === undefined) {
        return {};
    }
    return {
        PATH: `${path.dirname(secrets.script)}:${process.env.PATH === undefined ? '/usr/local/bin:/usr/bin:/bin' : process.env.PATH}`,
        SERVICEMAN_SECRETS: secrets.tsv,
    };
}

module.exports = secrets_env;

};
modules["agent/src/agent_program_logs"] = function (module, exports, require) {
// What a program running here has said, for the Logs button on the host. Only what this agent
// started is known: an agent that was restarted itself has nothing to show.
function agent_program_logs(state, params)
{
    const found = state.programs[`${params.name}#${params.slot}`];
    if (found === undefined) {
        return {text: ''};
    }
    return {text: found.output.join('\n')};
}

module.exports = agent_program_logs;

};
modules["agent/src/agent_program_probe"] = function (module, exports, require) {
// Is the program still running here? Only what this agent started is known: an agent that was
// restarted itself remembers nothing, and the host starts the app again.
function agent_program_probe(state, params)
{
    const found = state.programs[`${params.name}#${params.slot}`];
    if (found === undefined) {
        return {running: false, pid: null};
    }
    return {running: true, pid: found.child.pid};
}

module.exports = agent_program_probe;

};
modules["agent/src/agent_program_remove"] = function (module, exports, require) {
const agent_services_dir = require('agent/src/agent_services_dir');
const fs = require('fs');
const path = require('path');

// Takes away a folder the agent made for a program, and nothing else: the path has to be
// inside the agent's own services folder, and it cannot be that folder. serviceman only asks
// for folders it chose itself, and this is the second lock on the same door.
async function agent_program_remove(params)
{
    const root = agent_services_dir();
    const dir = path.resolve(root, params.cwd === null || params.cwd === undefined ? '.' : params.cwd);
    if (dir === root || dir.startsWith(`${root}${path.sep}`) === false) {
        throw new Error(`${dir} is not a folder this agent made`);
    }
    if (fs.existsSync(dir) === false) {
        return {removed: false};
    }
    await fs.promises.rm(dir, {recursive: true, force: true});
    return {removed: true};
}

module.exports = agent_program_remove;

};
modules["agent/src/agent_program_start"] = function (module, exports, require) {
const agent_link = require('agent/src/agent_link');
const agent_say = require('agent/src/agent_say');
const agent_services_dir = require('agent/src/agent_services_dir');
const child_process = require('child_process');
const fs = require('fs');
const link_send_message = require('helpers/link_send_message');
const log_uid = require('helpers/log_uid');
const path = require('path');
const stream = require('stream');
const stream_each = require('@vbarbarosh/node-helpers/src/stream_each');
const stream_lines = require('@vbarbarosh/node-helpers/src/stream_lines');

// The last words of a program, kept for whoever asks for its log
const KEEP_LINES = 400;

// Runs the program in its folder and keeps the child, so that the host can stop it again. The
// process group is its own, which is how a shell line takes its children with it when it goes.
//
// What it prints is written down as it prints it, under a group of the program's own: it runs
// for hours and speaks the whole time, which is exactly what a group is for.
function agent_program_start(state, params, group)
{
    const key = `${params.name}#${params.slot}`;
    const found = state.programs[key];
    if (found !== undefined && found.child.exitCode === null && found.child.signalCode === null) {
        return {pid: found.child.pid, started: false};
    }
    const cwd = path.resolve(agent_services_dir(), params.cwd === null || params.cwd === undefined ? '.' : params.cwd);
    // A program with no folder of its own runs in the services folder, which is this agent's
    // to make; a folder named in the config is somebody's own, and is not made here
    if (params.cwd === null || params.cwd === undefined || path.isAbsolute(params.cwd) === false) {
        fs.mkdirSync(cwd, {recursive: true});
    }
    const child = child_process.spawn(params.argv[0], params.argv.slice(1), {
        cwd,
        env: Object.assign({}, process.env, params.env || {}),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const own = log_uid();
    const kept = [];
    agent_say(own, 'group_spawn', (group === undefined ? undefined : {parent: group}));
    agent_say(own, 'program_begin', {service: params.name, slot: params.slot, pid: child.pid, cwd: params.cwd, argv: params.argv.join(' ')});
    state.programs[key] = {child, cwd, output: kept};
    read(child.stdout, 'program_stdout', own, params, kept);
    read(child.stderr, 'program_stderr', own, params, kept);
    child.on('exit', function (code, signal) {
        ended(state, key, child, own, params, (signal === null ? `code ${code}` : signal), code, signal);
    });
    // A command that cannot be run at all — no such program, a folder that is not there — ends
    // here instead of exiting, and it ends the same way for the host: as a program that failed
    child.on('error', function (error) {
        kept.push(error.message);
        ended(state, key, child, own, params, error.message, null, null);
    });
    return {pid: child.pid, started: true};
}

function ended(state, key, child, own, params, how, code, signal)
{
    agent_say(own, 'program_end', {service: params.name, slot: params.slot, how});
    if (state.programs[key] !== undefined && state.programs[key].child === child) {
        delete state.programs[key];
    }
    ended_told(params, code, signal);
}

// The host holds the restart policy, so it is told the fact apart from the line: a line is for
// reading, this is for acting on. A machine with no link says it to nobody, and the host finds
// out the usual way when it asks again.
function ended_told(params, code, signal)
{
    const socket = agent_link();
    if (socket === null || socket.destroyed) {
        return;
    }
    try {
        link_send_message(socket, {type: 'program_end', service: params.name, slot: params.slot, code, signal});
    }
    catch {
        // The link went while this was being written; the host will ask
    }
}

function read(source, sender, group, params, kept)
{
    stream.promises.pipeline(source, stream_lines(), stream_each(function (line) {
        kept.push(line);
        while (kept.length > KEEP_LINES) {
            kept.shift();
        }
        if (line.trim() !== '') {
            agent_say(group, sender, line, params.name);
        }
    })).catch(function () {
        // The program closed its output, which is what a program that stops does
    });
}

module.exports = agent_program_start;

};
modules["agent/src/agent_program_step"] = function (module, exports, require) {
const agent_services_dir = require('agent/src/agent_services_dir');
const path = require('path');
const program_line_argv = require('helpers/program_line_argv');
const secrets_env = require('helpers/secrets_env');
const shell_stream = require('helpers/shell_stream');

// One line of a program's life, run here. A folder written as a relative path is this
// machine's to place, and it places it under the agent's own services folder.
function agent_program_step(options, params, say)
{
    const cwd = path.resolve(agent_services_dir(), params.cwd === null || params.cwd === undefined ? '.' : params.cwd);
    return shell_stream(program_line_argv(params.line, cwd, params.image, params.env, options.docker, params.user, params.secrets), {
        cwd,
        env: Object.assign({}, process.env, secrets_env(params.secrets), params.env || {}),
    }, say);
}

module.exports = agent_program_step;

};
modules["agent/src/agent_program_stop"] = function (module, exports, require) {
const agent_say = require('agent/src/agent_say');
const format_seconds = require('helpers/format_seconds');
const program_kill = require('helpers/program_kill');

// Stops what agent_program_start started: the whole group, asked first and made to go after.
// The wait is for the group — the process this agent started is only the first of a chain, and
// it is the last of the chain that holds the port.
async function agent_program_stop(state, params, group)
{
    const key = `${params.name}#${params.slot}`;
    const found = state.programs[key];
    if (found === undefined) {
        return {stopped: false};
    }
    delete state.programs[key];
    const out = await program_kill(found.child.pid, (params.grace_ms === null || params.grace_ms === undefined ? undefined : params.grace_ms));
    if (out.killed) {
        agent_say(group, 'program_killed', `${format_seconds(out.waited_ms)} service=${params.name} pid=${found.child.pid} note="it was asked to stop and did not"`);
    }
    return {stopped: true, killed: out.killed};
}

module.exports = agent_program_stop;

};
modules["helpers/format_seconds"] = function (module, exports, require) {
// How long something took, the way the house writes it: seconds, to the millisecond.
//
//     0.006s   4.512s   30.001s
function format_seconds(ms)
{
    return `${(ms/1000).toFixed(3)}s`;
}

module.exports = format_seconds;

};
modules["helpers/program_kill"] = function (module, exports, require) {
const timers = require('timers/promises');

// How long a program is given to stop by itself before it is made to, and how often it is
// looked at while it takes its time
const GRACE_MS = 5000;
const LOOK_EVERY_MS = 50;

// Stops a program and everything it started, and does not come back until nothing of it is
// left. A shell line is a chain — `bash` → `npm` → `sh` → the server — and neither bash nor
// npm passes a signal on, so the one process serviceman started is never the one that matters.
// That is why the signal goes to the group, and why the wait is for the group as well: the
// first process of it dies at once, and waiting for that one would call the service stopped
// while the server under it still held the port.
//
// The answer says what it took, because a program that needed the second signal is a program
// with something wrong in the middle of it — see notes/signals-through-a-process-chain.md.
async function program_kill(pid, grace_ms)
{
    if (alive(pid) === false) {
        return {gone: true, killed: false, waited_ms: 0};
    }
    const at = Date.now();
    const deadline = at + (grace_ms === undefined ? GRACE_MS : grace_ms);
    signal(pid, 'SIGTERM');
    while (alive(pid) && Date.now() < deadline) {
        await timers.setTimeout(LOOK_EVERY_MS);
    }
    if (alive(pid) === false) {
        return {gone: true, killed: false, waited_ms: Date.now() - at};
    }
    signal(pid, 'SIGKILL');
    // Nothing survives a SIGKILL, but the kernel takes its own moment over it, and saying it is
    // gone before it is would be the same lie in a smaller size
    const dead_by = Date.now() + GRACE_MS;
    while (alive(pid) && Date.now() < dead_by) {
        await timers.setTimeout(LOOK_EVERY_MS);
    }
    return {gone: alive(pid) === false, killed: true, waited_ms: Date.now() - at};
}

// Whether anything of the group is left. Signal 0 asks without touching: it succeeds while at
// least one process of the group is there, and a group nobody may signal is still a group that
// exists — that is what the permission error means, and it is not `gone`.
function alive(pid)
{
    try {
        process.kill(-pid, 0);
        return true;
    }
    catch (error) {
        return error.code === 'EPERM';
    }
}

// The group, and the process itself when it turned out not to lead one
function signal(pid, name)
{
    try {
        process.kill(-pid, name);
    }
    catch {
        try {
            process.kill(pid, name);
        }
        catch {
            // It went between the looking and the signalling, which is the outcome anyway
        }
    }
}

program_kill.GRACE_MS = GRACE_MS;

module.exports = program_kill;

};
modules["agent/src/agent_resources"] = function (module, exports, require) {
const agent_addresses = require('agent/src/agent_addresses');
const agent_can = require('agent/src/agent_can');
const agent_dir = require('agent/src/agent_dir');
const agent_disk = require('agent/src/agent_disk');
const agent_doors_state = require('agent/src/agent_doors_state');
const agent_logline_read = require('agent/src/agent_logline_read');
const agent_os = require('agent/src/agent_os');
const agent_peer_serve = require('agent/src/agent_peer_serve');
const agent_shell = require('agent/src/agent_shell');
const crypto = require('crypto');
const docker_socket_path = require('helpers/docker_socket_path');
const os = require('os');

// What the machine is: said once, when the link opens
async function agent_resources(options)
{
    const cpus = os.cpus();
    const disk = await agent_disk(options.dir);
    const docker = await agent_shell([options.docker, 'version', '--format', '{{.Server.Version}}']);
    const can = await agent_can(options);
    return {
        hostname: os.hostname(),
        // Who the agent is on that machine: whose desktop session it can reach, whose shell a
        // terminal opens, and the name a sudoers line has to carry
        user: os.userInfo().username,
        os: agent_os(),
        platform: `${os.type()} ${os.release()}`,
        arch: os.arch(),
        node: process.version,
        cpu: {
            count: cpus.length,
            model: (cpus.length === 0 ? 'unknown' : cpus[0].model.trim()),
        },
        mem: {total: os.totalmem()},
        disk,
        docker: (docker.ok ? `docker ${docker.stdout}` : null),
        // The host reaches this socket through the link when it wants a shell in a container
        docker_socket: docker_socket_path({}, process.env),
        // What this agent can be asked for, by name. The host reads the list before asking:
        // a feature not named here is one this agent predates, and it is not asked.
        can,
        // Where this agent lives. What a service keeps is a folder under it, and the host has
        // to write that path into a `docker run` line it builds here.
        dir: agent_dir(),
        // Where other machines see this one: what Logline binds this machine's token to
        addresses: agent_addresses(),
        // What it was last told about Logline, so the host tells it only what changed. The
        // token is named by its hash: it is not the host's to read back.
        logline: logline_said(),
        // Which door table it serves from, so the host sends one only when it differs, and
        // where its peers reach it
        doors: {version: (agent_doors_state.table === null ? null : agent_doors_state.table.version), peer: agent_peer_serve.where()},
    };
}

// null when the file cannot be read: the host then tells it afresh, and the telling says why
// it fails
function logline_said()
{
    let kept;
    try {
        kept = agent_logline_read();
    }
    catch {
        return null;
    }
    return {
        logs: kept.logs,
        endpoint: kept.endpoint,
        token_sha: (kept.token === null ? null : crypto.createHash('sha256').update(kept.token).digest('hex')),
        floor: kept.floor,
        dirs: kept.dirs,
    };
}

module.exports = agent_resources;

};
modules["agent/src/agent_can"] = function (module, exports, require) {
const agent_root_there = require('agent/src/agent_root_there');

// What this agent can be asked for, by name. It is not a fact of the build alone: a machine
// gains a root half the moment somebody installs one, without the agent restarting — so this
// is asked again on every heartbeat, and the host hears about it within the half minute.
async function agent_can(options)
{
    const out = ['apt', 'disk_list', 'doors', 'files', 'fs_list', 'logline', 'machine_shell', 'package_list', 'port_list', 'proc_list', 'screenshot', 'update'];
    if (await agent_root_there(options)) {
        out.push('root');
    }
    out.sort();
    return out;
}

module.exports = agent_can;

};
modules["agent/src/agent_root_there"] = function (module, exports, require) {
const agent_root_ping = require('agent/src/agent_root_ping');

// Whether this machine has a root half the agent may ask. It is asked, not looked for: a
// socket file that nothing answers is a socket file, and the host is told what is true now.
async function agent_root_there(options)
{
    return (await agent_root_ping(options)) !== null;
}

module.exports = agent_root_there;

};
modules["agent/src/agent_root_ping"] = function (module, exports, require) {
const agent_root_ask = require('agent/src/agent_root_ask');

// What the root half of this machine says about itself, or null when there is none. It names
// the build it is running, because the file it was started from is replaced by an update
// while it goes on running the old one — and something has to notice.
async function agent_root_ping(options)
{
    try {
        return await agent_root_ask(options, 'ping', {});
    }
    catch {
        return null;
    }
}

module.exports = agent_root_ping;

};
modules["agent/src/agent_root_ask"] = function (module, exports, require) {
const agent_root_socket = require('agent/src/agent_root_socket');
const net = require('net');

// One job for the root half of this machine, over its socket: the question is a line of json,
// the answer is lines of json — what the work printed as it printed it, then how it ended.
// One connection is one job, because a socket on the same machine is cheap and a protocol
// that carries two jobs at once is not.
//
// A machine with no root agent says so as `NOROOT`, which is not a failure of the work: it is
// the answer to "may this be done at all here".
function agent_root_ask(options, method, params, say)
{
    const path = agent_root_socket(options);
    return new Promise(function (resolve, reject) {
        const socket = net.connect({path});
        let rest = '';
        let answered = false;
        socket.on('connect', function () {
            socket.write(`${JSON.stringify({method, params: (params === undefined ? {} : params)})}\n`);
        });
        socket.on('data', function (chunk) {
            rest += chunk.toString('utf8');
            for (;;) {
                const at = rest.indexOf('\n');
                if (at === -1) {
                    return;
                }
                const line = rest.slice(0, at);
                rest = rest.slice(at + 1);
                const message = message_from_line(line);
                if (message === null) {
                    continue;
                }
                if (message.type === 'line' && say !== undefined && say !== null) {
                    say(message.stream, message.text);
                    continue;
                }
                if (message.type === 'reply') {
                    answered = true;
                    socket.end();
                    if (message.ok) {
                        resolve(message.value);
                        return;
                    }
                    reject(refused(message.error));
                    return;
                }
            }
        });
        socket.on('error', function (error) {
            reject(no_root(error));
        });
        socket.on('close', function () {
            if (answered === false) {
                reject(new Error('the root agent closed without answering'));
            }
        });
    });
}

// A root half from before the work being asked for is, for that work, a machine without one:
// the asker does what it can in its own session instead of failing. The words are the root
// half's own, written in the one place that refuses a method it has never heard of.
function refused(text)
{
    const out = new Error(text);
    if (text.includes('knows nothing called')) {
        out.code = 'NOROOT';
    }
    return out;
}

// A socket that is not there, or one this user may not open, both mean the same thing: this
// machine has no root half for the agent to ask
function no_root(error)
{
    const out = new Error(`no root agent on this machine — ${error.message}`);
    if (['ENOENT', 'ECONNREFUSED', 'EACCES', 'EPERM'].includes(error.code)) {
        out.code = 'NOROOT';
    }
    return out;
}

function message_from_line(line)
{
    try {
        return JSON.parse(line);
    }
    catch {
        return null;
    }
}

module.exports = agent_root_ask;

};
modules["agent/src/agent_disk"] = function (module, exports, require) {
const agent_shell = require('agent/src/agent_shell');

const BLOCK_BYTES = 1024;

// How much room is left where the services will live
async function agent_disk(dir)
{
    const answer = await agent_shell(['df', '-kP', dir]);
    const line = answer.stdout.split('\n')[1];
    if (answer.ok === false || line === undefined) {
        return {path: dir, total: null, free: null};
    }
    const columns = line.trim().split(/\s+/);
    return {
        path: dir,
        total: parseInt(columns[1], 10)*BLOCK_BYTES,
        free: parseInt(columns[3], 10)*BLOCK_BYTES,
    };
}

module.exports = agent_disk;

};
modules["agent/src/agent_os"] = function (module, exports, require) {
const fs = require('fs');

const OS_RELEASE = '/etc/os-release';

// The name a person calls this system — "Ubuntu 24.04.2 LTS" — as os-release says it
function agent_os()
{
    try {
        const found = /^PRETTY_NAME="?([^"\n]*)"?$/m.exec(fs.readFileSync(OS_RELEASE, 'utf8'));
        if (found !== null && found[1] !== '') {
            return found[1];
        }
    }
    catch {
        // not a linux box
    }
    return null;
}

module.exports = agent_os;

};
modules["helpers/docker_socket_path"] = function (module, exports, require) {
// The socket the REMOTE_API_KEEP is asked through; a docker that lives on another machine has none here
function docker_socket_path(config, env)
{
    if (config.docker_socket) {
        return config.docker_socket;
    }
    const host = env.DOCKER_HOST || '';
    if (host === '') {
        return '/var/run/docker.sock';
    }
    if (host.startsWith('unix://')) {
        return host.slice('unix://'.length);
    }
    if (host.startsWith('/')) {
        return host;
    }
    return null;
}

module.exports = docker_socket_path;

};
modules["agent/src/agent_root_current"] = function (module, exports, require) {
const agent_built = require('agent/src/agent_built');
const agent_root_ask = require('agent/src/agent_root_ask');
const agent_root_ping = require('agent/src/agent_root_ping');
const agent_say = require('agent/src/agent_say');
const timers = require('timers/promises');

// How long the system is given to start the new one before this end calls it gone
const BACK_WITHIN_MS = 15000;
const LOOK_EVERY_MS = 1000;

// Said once about one build, not once every half minute: a line that repeats forever is a
// line nobody reads
let said_about = null;

// The two halves of a machine run from the same file, and an update replaces that file under
// both of them — but only the session half is started again by it. The root half goes on
// running the code it read at boot, which is the old code, until something says so. This is
// that something: it is asked to stop, and the system that keeps it up starts the new one.
async function agent_root_current(options, group)
{
    const said = await agent_root_ping(options);
    if (said === null || said.built === agent_built) {
        said_about = null;
        return false;
    }
    // A root half that says nothing about being kept up is one from before it could say so —
    // the same update that left it behind. Installed by bin/install-root it is under systemd,
    // so it is asked, and this end watches for it to come back rather than assuming.
    if (said.supervised === false) {
        say_once(said, group, 'root_update_by_hand', {then: 'nothing would start it again'});
        return false;
    }
    agent_say(group, 'root_update_asked', {running: said.built, serving: agent_built});
    await agent_root_ask(options, 'restart', {});
    if (await back_again(options)) {
        said_about = null;
        return true;
    }
    say_once(said, group, 'root_update_gone', {then: 'nothing started it again — sudo systemctl start serviceman-agent-root on that machine'});
    return false;
}

// Whether the new one is answering. It is a socket on the same machine, so this is a second
// or two, not a wait worth making anybody sit through.
async function back_again(options)
{
    const until = Date.now() + BACK_WITHIN_MS;
    while (Date.now() < until) {
        await timers.setTimeout(LOOK_EVERY_MS);
        const said = await agent_root_ping(options);
        if (said !== null) {
            return true;
        }
    }
    return false;
}

function say_once(said, group, sender, words)
{
    if (said_about === String(said.built)) {
        return;
    }
    said_about = String(said.built);
    agent_say(group, sender, Object.assign({running: said.built, serving: agent_built}, words));
}

module.exports = agent_root_current;

};
modules["agent/src/agent_root_or"] = function (module, exports, require) {
const agent_root_ask = require('agent/src/agent_root_ask');

// Work that wants root: the root half of this machine does it when there is one, and what is
// given here is done in this session when there is not — with sudo in front of it, and sudo
// with nobody to answer it says so. A machine either has the root agent or it does not, and
// the difference is not the work's to hide.
async function agent_root_or(options, method, params, say, otherwise)
{
    try {
        return await agent_root_ask(options, method, params, say);
    }
    catch (error) {
        if (error.code !== 'NOROOT') {
            throw error;
        }
        return await otherwise();
    }
}

module.exports = agent_root_or;

};
modules["agent/src/agent_screenshot"] = function (module, exports, require) {
const agent_shell = require('agent/src/agent_shell');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Nothing this small is a screen; a picture under it is an empty window somebody grabbed
const SMALLEST_SCREEN = 100;
// A picture of a screen carries detail, and detail does not compress to nothing. A screenful
// of one colour comes back at a few thousand bytes a megapixel; a real one, even a dark one
// with a single terminal on it, is tens of thousands. Anything under this is not a picture of
// anything: a screen that is off or locked, or a way in that cannot see what is drawn.
const A_SCREENFUL = 250000;
const FLAT_UNDER_BYTES_PER_MP = 4000;

// How long one way in may take before it is stopped, and how long the whole question may take.
// A screenshot is a fast thing or it is nothing: a tool that sits there is waiting for
// somebody to click something, and there is nobody at this end to click it. The host gives up
// at thirty seconds, so everything here has to be over before that with room to say so.
const EACH_MS = 6000;
const ALL_MS = 20000;

// Wayland keeps moving the door: every GNOME release allows a different caller, and none of
// them is everywhere. So the ways in are tried in order, and when none works the answer names
// what each one said — pressed on a machine, the button is how you find out what that machine
// allows. A --screenshot line of your own goes first and alone.
function candidates(options, file)
{
    if (options.screenshot !== '') {
        return [{method: 'the --screenshot line', argv: ['/bin/sh', '-c', options.screenshot.split('%f').join(file)]}];
    }
    return [
        {method: 'gnome-screenshot', argv: ['gnome-screenshot', '-f', file]},
        // With a deadline of its own: a dbus call whose far end never answers waits out dbus's
        // own minute, and this whole question is worth seconds
        {method: 'gnome-shell over dbus', argv: ['gdbus', 'call', '--timeout', String(Math.round(EACH_MS/1000)), '--session', '--dest', 'org.gnome.Shell.Screenshot', '--object-path', '/org/gnome/Shell/Screenshot', '--method', 'org.gnome.Shell.Screenshot.Screenshot', 'false', 'false', file]},
        {method: 'grim', argv: ['grim', file]},
        // `-screen` is the whole difference on a composited X11 desktop: without it, what is
        // grabbed is the root window's own contents, and a compositor draws nothing there —
        // the answer is the right size and one flat colour
        {method: 'import', argv: ['import', '-screen', '-window', 'root', file]},
    ];
}

// What is on the machine's screen, as one png. The agent lives in the user's session, so it
// may ask; a session variable a user unit was not given is filled with the usual value.
async function agent_screenshot(options)
{
    const file = where(process.pid);
    const env = Object.assign({}, process.env, {
        WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || 'wayland-0',
        DISPLAY: process.env.DISPLAY || ':0',
    });
    const tried = [];
    const until = Date.now() + ALL_MS;
    for (const item of candidates(options, file)) {
        if (Date.now() >= until) {
            tried.push(`${item.method}: not asked — the ones before it took the time there was`);
            continue;
        }
        // Every way in is given a few seconds and then stopped. A screenshot tool that waits is
        // one that has opened a window on that screen and is waiting for a person to click it:
        // there is nobody there, and leaving it up would be leaving a window on somebody's
        // desktop for the sake of a picture nobody got.
        const answer = await agent_shell(item.argv, {env, timeout: EACH_MS, killSignal: 'SIGKILL'});
        const png = png_read(file);
        const size = (png === null ? null : png_size(png));
        if (answer.ok && size !== null && big_enough(size) && flat(size, png) === false) {
            return {ok: true, method: item.method, bytes: png.length, width: size.width, height: size.height, png: png.toString('base64')};
        }
        // A command that wrote a picture the size of a postage stamp did not take a picture of
        // the screen. `import` on a wayland session does exactly that: the X root window it
        // grabs has nothing in it, and a blank answer counted as success is worse than none.
        tried.push(`${item.method}: ${why(answer, size, file)}`.trim());
    }
    return {ok: false, tried, stderr: tried.join(' · ')};
}

// Where the picture is written. Not /tmp: a screenshot tool installed as a snap has a /tmp of
// its own, so it writes a file that is real over there and missing here — which looks exactly
// like a tool that did nothing. A folder under the person's home is one both ends can see.
function where(pid)
{
    const home = process.env.HOME;
    if (home === undefined || home === '') {
        return path.join(os.tmpdir(), `serviceman-shot-${pid}.png`);
    }
    const dir = path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'serviceman');
    try {
        fs.mkdirSync(dir, {recursive: true});
        return path.join(dir, `shot-${pid}.png`);
    }
    catch {
        return path.join(os.tmpdir(), `serviceman-shot-${pid}.png`);
    }
}

// Why this way in did not give a picture, in the words of whatever refused. A command that
// says nothing at all still says how it ended, and whether anything appeared where it was
// told to write — which is the difference between a tool that failed and one confined
// somewhere this end cannot see.
function why(answer, size, file)
{
    if (answer.killed) {
        return `waited longer than ${Math.round(EACH_MS/1000)}s and was stopped — it wants somebody at that machine to click something`;
    }
    if (size !== null && big_enough(size) === false) {
        return `wrote a ${size.width}×${size.height} picture, which is not this screen`;
    }
    if (size !== null) {
        return `wrote a ${size.width}×${size.height} picture of one flat colour — the screen is off or locked, or this way in cannot see what is drawn`;
    }
    const out = (answer.stderr || answer.stdout || '').trim();
    if (out !== '') {
        return out;
    }
    return `ended ${answer.code} and wrote no file at ${file}`;
}

function big_enough(size)
{
    return size.width >= SMALLEST_SCREEN && size.height >= SMALLEST_SCREEN;
}

// Whether the picture is all one colour, judged by how small it came out for its size — no
// decoding, because a png of a real screen never compresses this far
function flat(size, png)
{
    const pixels = size.width*size.height;
    return pixels >= A_SCREENFUL && png.length*1000000/pixels < FLAT_UNDER_BYTES_PER_MP;
}

// How wide and tall the png says it is: the first chunk of the file, always, and it is there
// before any of the pixels
function png_size(png)
{
    if (png.length < 24 || png.toString('ascii', 12, 16) !== 'IHDR') {
        return null;
    }
    return {width: png.readUInt32BE(16), height: png.readUInt32BE(20)};
}

function png_read(file)
{
    try {
        const out = fs.readFileSync(file);
        fs.unlinkSync(file);
        return (out.length === 0 ? null : out);
    }
    catch {
        return null;
    }
}

module.exports = agent_screenshot;

};
modules["agent/src/agent_secrets_put"] = function (module, exports, require) {
const agent_dir = require('agent/src/agent_dir');
const path = require('path');
const secrets_files_write = require('helpers/secrets_files_write');

// The host hands down the secrets one service may see. They land in the agent's own folder,
// readable by nobody else, and go away with the folder when the agent does.
function agent_secrets_put(params)
{
    return secrets_files_write(path.join(agent_dir(), 'secrets'), params.service, params.secrets || {});
}

module.exports = agent_secrets_put;

};
modules["helpers/secrets_files_write"] = function (module, exports, require) {
const fs = require('fs');
const path = require('path');

const FILE_MODE = 0o600;
const SCRIPT_MODE = 0o755;
const SCRIPT_NAME = 'secrets';

// `secrets <name>`, as a shell script, because that is how a program asks for one: it runs a
// command and reads what it prints. sh and awk are in every image worth running.
const SCRIPT = `#!/bin/sh
# secrets <name> — prints the secret of that name, or nothing and 1 when there is none.
# Written by serviceman. The file it reads is only readable by whoever runs this.

set -eu

file=\${SERVICEMAN_SECRETS:-/run/serviceman/secrets.tsv}

line=$(awk -F '\\t' -v want="$1" '$1 == want { print $2; found = 1; exit } END { exit !found }' "$file")
printf '%b\\n' "$line"
`;

// The secrets one service may see, on the machine that runs it: one file it can read, and one
// command that reads it. Both are written fresh every time, so a secret that changed is the
// one the next start uses, and a secret taken away is gone from the machine as well.
function secrets_files_write(dir, service, secrets)
{
    fs.mkdirSync(dir, {recursive: true});
    const script = path.join(dir, SCRIPT_NAME);
    fs.writeFileSync(script, SCRIPT, {mode: SCRIPT_MODE});
    fs.chmodSync(script, SCRIPT_MODE);
    const tsv = path.join(dir, `${service}.tsv`);
    const lines = [];
    for (const name of Object.keys(secrets)) {
        // One line each, whatever the value is: a newline in a secret is a newline in the file
        // otherwise, and the next name would be read as part of the last value
        lines.push(`${name}\t${String(secrets[name]).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}`);
    }
    fs.writeFileSync(tsv, `${lines.join('\n')}\n`, {mode: FILE_MODE});
    fs.chmodSync(tsv, FILE_MODE);
    return {tsv, script};
}

module.exports = secrets_files_write;

};
modules["agent/src/agent_stats"] = function (module, exports, require) {
const agent_battery = require('agent/src/agent_battery');
const agent_can = require('agent/src/agent_can');
const agent_cpu_busy = require('agent/src/agent_cpu_busy');
const agent_disk = require('agent/src/agent_disk');
const agent_disks = require('agent/src/agent_disks');
const agent_doors_state = require('agent/src/agent_doors_state');
const agent_http_serve = require('agent/src/agent_http_serve');
const agent_logline_status = require('agent/src/agent_logline_status');
const agent_mem_free = require('agent/src/agent_mem_free');
const agent_temperature = require('agent/src/agent_temperature');
const agent_updates = require('agent/src/agent_updates');
const os = require('os');

// The numbers that move: what the machine carries right now — and what it can be asked for,
// which moves too: a machine gains a root half without its agent restarting
async function agent_stats(options)
{
    const disk = await agent_disk(options.dir);
    return {
        at: Date.now(),
        can: await agent_can(options),
        uptime_ms: Math.round(os.uptime()*1000),
        load: os.loadavg()[0],
        // How busy its cores were since the last beat, 0 to 1
        cpu_busy: await agent_cpu_busy(),
        mem_free: agent_mem_free(),
        disk_free: disk.free,
        // All of its disks together, for a line that says how full the machine is
        disks: await agent_disks(options.dir),
        battery: agent_battery(),
        // The way in, as its file says it stands right now
        door: agent_http_serve.door(),
        temperature: agent_temperature(),
        updates: await agent_updates(options),
        // How its lines to Logline are going
        logline: agent_logline_status(),
        // How long ago each service of this machine last had a request through a door, in this
        // machine's own time: serviceman counts it as the service being in use
        doors_seen: doors_seen_ago(),
    };
}

function doors_seen_ago()
{
    const out = {};
    const now = Date.now();
    for (const name of Object.keys(agent_doors_state.seen)) {
        out[name] = now - agent_doors_state.seen[name];
    }
    return out;
}

module.exports = agent_stats;

};
modules["agent/src/agent_battery"] = function (module, exports, require) {
const fs = require('fs');
const path = require('path');

const POWER_SUPPLY = '/sys/class/power_supply';

// How much is left in the laptop, and whether it is filling or emptying. A machine with no
// battery — a desktop, a server, a container — has nothing to say, and that is null.
function agent_battery()
{
    for (const name of names_read()) {
        const dir = path.join(POWER_SUPPLY, name);
        if (line_read(dir, 'type') !== 'Battery') {
            continue;
        }
        const percent = parseInt(line_read(dir, 'capacity'), 10);
        if (Number.isFinite(percent) === false) {
            continue;
        }
        return {percent, status: String(line_read(dir, 'status') || 'unknown').toLowerCase()};
    }
    return null;
}

function names_read()
{
    try {
        return fs.readdirSync(POWER_SUPPLY).sort();
    }
    catch {
        // not a linux box, or a linux box that knows nothing about power
        return [];
    }
}

function line_read(dir, name)
{
    try {
        return fs.readFileSync(path.join(dir, name), 'utf8').trim();
    }
    catch {
        return '';
    }
}

module.exports = agent_battery;

};
modules["agent/src/agent_cpu_busy"] = function (module, exports, require) {
const os = require('os');
const timers = require('timers/promises');

// A first reading has nothing before it to compare with: it is taken over this much time
const FIRST_WINDOW_MS = 250;

const last = {sample: null};

// How busy the cores were, 0 to 1, since the last time it was asked — the share of their time
// not spent idle, which is what top and htop call cpu use. The load average is not that: it
// counts what waits on disk and network too, and runs past 1 per core on a machine at half use.
async function agent_cpu_busy()
{
    if (last.sample === null) {
        last.sample = cpu_sample();
        await timers.setTimeout(FIRST_WINDOW_MS);
    }
    const before = last.sample;
    const now = cpu_sample();
    last.sample = now;
    const total = now.total - before.total;
    if (total <= 0) {
        return null;
    }
    return Math.min(1, Math.max(0, 1 - (now.idle - before.idle)/total));
}

// Every core's times added up: all of them, and the idle ones
function cpu_sample()
{
    let total = 0;
    let idle = 0;
    for (const cpu of os.cpus()) {
        const times = cpu.times;
        total += times.user + times.nice + times.sys + times.idle + times.irq;
        idle += times.idle;
    }
    return {total, idle};
}

module.exports = agent_cpu_busy;

};
modules["agent/src/agent_disks"] = function (module, exports, require) {
const agent_disk = require('agent/src/agent_disk');
const agent_shell = require('agent/src/agent_shell');
const disk_list_from_df = require('agent/src/disk_list_from_df');

// Every disk of the machine taken together: the room used over the room there is, counted
// the way the Disks tab counts them. A machine that shows no disk of its own, a container
// above all, is the one filesystem the agent lives on.
async function agent_disks(dir)
{
    const answer = await agent_shell(['df', '-PkT']);
    const disks = (answer.ok ? disk_list_from_df(answer.stdout, '').filter(v => v.disk) : []);
    if (disks.length > 0) {
        let total = 0;
        let used = 0;
        for (const item of disks) {
            total += item.total;
            used += item.used;
        }
        return {count: disks.length, total, used};
    }
    const disk = await agent_disk(dir);
    if (disk.total === null) {
        return null;
    }
    return {count: 1, total: disk.total, used: disk.total - disk.free};
}

module.exports = agent_disks;

};
modules["agent/src/agent_logline_status"] = function (module, exports, require) {
const agent_logline = require('agent/src/agent_logline');

// How this machine's lines are faring, for the host's Logs tab: how many went, how many wait
// here, how old the oldest waiting one is, and what Logline said last
function agent_logline_status()
{
    return agent_logline.status();
}

module.exports = agent_logline_status;

};
modules["agent/src/agent_mem_free"] = function (module, exports, require) {
const fs = require('fs');
const os = require('os');

const MEMINFO = '/proc/meminfo';

// Free memory as linux means it: the cache is free room, and os.freemem() does not say so
function agent_mem_free()
{
    try {
        const found = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync(MEMINFO, 'utf8'));
        if (found !== null) {
            return parseInt(found[1], 10)*1024;
        }
    }
    catch {
        // not a linux box
    }
    return os.freemem();
}

module.exports = agent_mem_free;

};
modules["agent/src/agent_temperature"] = function (module, exports, require) {
const fs = require('fs');
const path = require('path');

const THERMAL = '/sys/class/thermal';
const HOTTEST_SANE_C = 150;

// How hot the machine is running, as the hottest zone the kernel names — a laptop with a fan
// against the desk says so here. A machine that measures nothing has nothing to say.
function agent_temperature()
{
    let out = null;
    for (const name of names_read()) {
        if (name.startsWith('thermal_zone') === false) {
            continue;
        }
        const dir = path.join(THERMAL, name);
        // The kernel writes thousandths of a degree
        const c = Math.round(parseInt(line_read(dir, 'temp'), 10)/1000);
        if (Number.isFinite(c) === false || c <= 0 || c > HOTTEST_SANE_C) {
            continue;
        }
        if (out === null || c > out.c) {
            out = {c, of: line_read(dir, 'type') || name};
        }
    }
    return out;
}

function names_read()
{
    try {
        return fs.readdirSync(THERMAL).sort();
    }
    catch {
        // not a linux box, or one that measures nothing
        return [];
    }
}

function line_read(dir, name)
{
    try {
        return fs.readFileSync(path.join(dir, name), 'utf8').trim();
    }
    catch {
        return '';
    }
}

module.exports = agent_temperature;

};
modules["agent/src/agent_update"] = function (module, exports, require) {
const agent_dir = require('agent/src/agent_dir');
const agent_say = require('agent/src/agent_say');
const child_process = require('child_process');
const fs = require('fs');
const path = require('path');

// The last line of logs/update.log, and the code bin/update ended with after it
const UPDATE_END = 'serviceman: bin/update ended with code';
const TAIL_LINES = 6;

// The host says this machine is running an older agent than the one it serves. `bin/update` is
// what a person would run here, so that is what runs — it fetches everything again and starts
// the agent afresh, which means this process is about to be replaced. The answer goes back
// first, because after this there is nobody here to answer with.
//
// An agent the installer did not put here — a container above all — has no bin/update. The
// ask carries the new file for exactly that machine: written over this one, the process exits,
// and whatever keeps the agent up starts the new one.
//
// What bin/update prints goes to logs/update.log, with how it ended as the last line. A run
// that ends with this process still here did not replace it: why is said at once, in this
// machine's log and the host's, and again as the answer to the next ask, which runs it anew.
function agent_update(params, group)
{
    const script = path.join(agent_dir(), 'bin', 'update');
    if (fs.existsSync(script)) {
        const log_file = path.join(agent_dir(), 'logs', 'update.log');
        const failed = update_failed(log_file);
        if (failed !== null) {
            fs.rmSync(log_file, {force: true});
            return {started: false, reason: failed};
        }
        fs.mkdirSync(path.dirname(log_file), {recursive: true});
        const fd = fs.openSync(log_file, 'w');
        const line = `sh "$0"; echo "${UPDATE_END} $?"`;
        // systemd gives the agent a PATH of its own, which leaves out a node in ~/.local/bin; the
        // installer bin/update runs looks for node there, so this one is put first
        const env = Object.assign({}, process.env, {PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}`});
        const child = child_process.spawn('/bin/sh', ['-c', line, script], {detached: true, env, stdio: ['ignore', fd, fd]});
        fs.closeSync(fd);
        child.once('exit', function (code) {
            // Ended by a signal: the unit is being stopped for the new agent, which is the run
            // working
            if (code === null) {
                return;
            }
            const reason = update_failed(log_file);
            if (reason !== null) {
                agent_say(group, 'agent_update_failed', {reason});
            }
        });
        child.unref();
        return {started: true};
    }
    if (params !== undefined && typeof params.text === 'string' && params.text !== '') {
        const own = path.resolve(process.argv[1]);
        // Only a file the bundler wrote is the agent's to replace. An agent running from the
        // repo has source under it, and source is never overwritten from a link.
        if (fs.readFileSync(own, 'utf8').includes('modules["agent/index"]') === false) {
            return {started: false, reason: `${own} is not a bundled agent — this one runs from the repo and updates with it`};
        }
        fs.writeFileSync(`${own}.new`, params.text);
        fs.renameSync(`${own}.new`, own);
        // The answer leaves first; then this process steps aside for the file it just wrote
        setTimeout(function () {
            process.exit(0);
        }, 200);
        return {started: true};
    }
    return {started: false, reason: `${script} is not here — this agent was not installed by the installer, and the ask carried no file`};
}

// Why the last run of bin/update left this process standing, or null: it never ran, it is
// still running, or it ran before this process started — which is a run that worked
function update_failed(log_file)
{
    let text;
    try {
        if (fs.statSync(log_file).mtimeMs < Date.now() - process.uptime()*1000) {
            return null;
        }
        text = fs.readFileSync(log_file, 'utf8');
    }
    catch {
        return null;
    }
    const lines = text.split('\n').map(v => v.trimEnd()).filter(v => v !== '');
    const last = lines[lines.length - 1] || '';
    if (last.startsWith(UPDATE_END) === false) {
        return null;
    }
    const code = last.slice(UPDATE_END.length).trim();
    const said = lines.slice(Math.max(0, lines.length - 1 - TAIL_LINES), lines.length - 1).join(' | ');
    if (code === '0') {
        return `bin/update ran to the end, and this agent is still the old one${said === '' ? '' : ' — it said: ' + said}`;
    }
    return `bin/update failed with code ${code}${said === '' ? '' : ': ' + said}`;
}

module.exports = agent_update;

};
modules["helpers/last_line"] = function (module, exports, require) {
// The last thing a command said. Everything it said is already in the log, line by line, so a
// line that ends the work names the reason without repeating the rest of it.
function last_line(text)
{
    const lines = String(text === undefined || text === null ? '' : text).split('\n').filter(v => v.trim() !== '');
    return (lines.length === 0 ? 'it said nothing' : lines[lines.length - 1]);
}

module.exports = last_line;

};
modules["helpers/link_read"] = function (module, exports, require) {
const HEADER_BYTES = 5;
const LONGEST_FRAME_BYTES = 16*1024*1024;

// Reads whole frames off a link socket; TCP hands them over cut and glued in any way
function link_read(socket, on_frame)
{
    let rest = Buffer.alloc(0);
    socket.on('data', function (chunk) {
        rest = (rest.length === 0 ? chunk : Buffer.concat([rest, chunk]));
        for (;;) {
            if (rest.length < HEADER_BYTES) {
                return;
            }
            const length = rest.readUInt32BE(0);
            if (length > LONGEST_FRAME_BYTES) {
                socket.destroy(new Error(`a frame of ${length} bytes is larger than this link carries`));
                return;
            }
            if (rest.length < HEADER_BYTES + length) {
                return;
            }
            const kind = String.fromCharCode(rest.readUInt8(4));
            const body = Buffer.from(rest.subarray(HEADER_BYTES, HEADER_BYTES + length));
            rest = rest.subarray(HEADER_BYTES + length);
            on_frame(kind, body);
        }
    });
}

module.exports = link_read;

};
modules["../package.json"] = function (module, exports, require) {
module.exports = {
    "name": "serviceman",
    "version": "1.0.0",
    "private": true,
    "description": "Serve services by hostname, start them on the first request, stop them when idle",
    "main": "src/main/index.js",
    "scripts": {
        "start": "node src/main",
        "test": "node --test --test-concurrency=1 tests/*.test.js"
    },
    "dependencies": {
        "@vbarbarosh/node-helpers": "^3.78.0",
        "ws": "^8.21.3"
    },
    "devDependencies": {
        "@codemirror/commands": "^6.11.1",
        "@codemirror/lang-css": "^6.3.1",
        "@codemirror/lang-html": "^6.4.12",
        "@codemirror/lang-javascript": "^6.2.5",
        "@codemirror/lang-json": "^6.0.2",
        "@codemirror/lang-markdown": "^6.5.2",
        "@codemirror/lang-php": "^6.0.2",
        "@codemirror/lang-python": "^6.2.1",
        "@codemirror/lang-sql": "^6.10.0",
        "@codemirror/lang-xml": "^6.1.0",
        "@codemirror/lang-yaml": "^6.1.3",
        "@codemirror/language": "^6.12.4",
        "@codemirror/legacy-modes": "^6.5.4",
        "@codemirror/search": "^6.7.2",
        "@codemirror/state": "^6.7.6",
        "@codemirror/theme-one-dark": "^6.1.3",
        "@codemirror/view": "^6.43.13",
        "@xterm/addon-fit": "^0.11.0",
        "@xterm/xterm": "^6.0.0",
        "ace-builds": "^1.44.0",
        "codemirror": "^6.0.2",
        "esbuild": "^0.28.2",
        "nodemon": "^3.1.14",
        "vue": "^3.5.41"
    }
};
};
modules["helpers/shell_pty_argv"] = function (module, exports, require) {
// A command run through a terminal that is not there. Some programs — `docker pull` above all
// — only show their progress when they believe a person is watching: docker drops every
// message that carries a progress bar unless its output is a terminal, so through a pipe a
// four hundred megabyte download says `Downloading` once and nothing after it.
//
// `script` gives it the terminal it is looking for. `-q` says nothing of its own, `-e` gives
// back the exit status of the command instead of its own, `-f` flushes each write through, and
// `-c` is the command. What comes back is written for a screen: lines that end in a carriage
// return, and escapes that move the cursor about.
function shell_pty_argv(argv)
{
    return ['script', '-qefc', argv.map(quoted).join(' '), '/dev/null'];
}

// A word for /bin/sh, safe whatever is in it
function quoted(word)
{
    if (/^[a-zA-Z0-9_./:@-]+$/.test(word)) {
        return word;
    }
    return `'${String(word).replace(/'/g, "'\\''")}'`;
}

module.exports = shell_pty_argv;

};
modules["agent/src/agent_sleep_watch"] = function (module, exports, require) {
const agent_bye = require('agent/src/agent_bye');
const child_process = require('child_process');

// A laptop that suspends says so first. systemd-logind tells everything on the machine that
// sleep is coming — that is what `PrepareForSleep true` is — and this listens for it, so the
// host learns the machine is going to sleep instead of watching it stop answering.
//
// It is a line reader over `gdbus monitor` rather than a dbus library: the agent is one file
// with nothing under it, and this is one long-lived process reading one kind of line. A
// machine without gdbus, or without logind, simply never says it is sleeping.
function agent_sleep_watch(say)
{
    let out;
    try {
        out = child_process.spawn('gdbus', [
            'monitor',
            '--system',
            '--dest', 'org.freedesktop.login1',
            '--object-path', '/org/freedesktop/login1',
        ], {stdio: ['ignore', 'pipe', 'ignore']});
    }
    catch {
        return null;
    }
    let rest = '';
    out.stdout.on('data', function (chunk) {
        rest += chunk.toString('utf8');
        const lines = rest.split('\n');
        rest = lines.pop();
        for (const line of lines) {
            if (/PrepareForSleep \(true,?\)/.test(line)) {
                say('suspending');
                agent_bye('suspending');
            }
        }
    });
    out.on('error', function () {
        // No gdbus on this machine; nothing here to do about it
    });
    // It must not hold the process open: the agent ends when the agent ends
    out.unref();
    return out;
}

module.exports = agent_sleep_watch;

};
modules["agent/src/agent_status_ask"] = function (module, exports, require) {
const agent_dir = require('agent/src/agent_dir');
const net = require('net');
const path = require('path');

// `bin/status` asks the agent, and the agent answers. Nothing here reads a file: an agent that
// cannot be asked is an agent that is not running, and that is the answer.
function agent_status_ask()
{
    const file = path.join(agent_dir(), 'status.sock');
    return new Promise(function (resolve) {
        const socket = net.connect(file);
        const chunks = [];
        socket.on('data', function (chunk) {
            chunks.push(chunk);
        });
        socket.on('end', function () {
            process.stdout.write(Buffer.concat(chunks).toString('utf8'));
            resolve(0);
        });
        socket.on('error', function (error) {
            console.error(`serviceman-agent: no agent is answering at ${file} — ${error.message}`);
            resolve(1);
        });
    });
}

module.exports = agent_status_ask;

};
modules["agent/src/agent_status_serve"] = function (module, exports, require) {
const agent_dir = require('agent/src/agent_dir');
const agent_root_there = require('agent/src/agent_root_there');
const agent_status = require('agent/src/agent_status');
const fs = require('fs');
const net = require('net');
const path = require('path');

const SOCKET_MODE = 0o600;

// The agent answers for itself: a socket beside it, and whoever opens it gets what is going on
// at that moment. Nothing is kept on disk to go stale — a status file is a promise about the
// past, and the one question worth asking of an agent is what it is doing now.
function agent_status_serve(status, options)
{
    const file = path.join(agent_dir(), 'status.sock');
    const out = net.createServer(function (socket) {
        socket.on('error', function () {
            socket.destroy();
        });
        // The root half is asked for here rather than remembered: one installed a minute ago
        // is one this answer should already know about
        const promise = agent_root_there(options);
        promise.then(function (there) {
            status.root = there;
            socket.end(agent_status(status));
        });
    });
    out.on('error', function (error) {
        console.error(`serviceman-agent: the status socket cannot be opened — ${error.message}`);
    });
    // A socket file outlives the process that made it; one nobody answers on is this one's to take
    try {
        fs.unlinkSync(file);
    }
    catch {
        // It was not there, which is the usual case
    }
    out.listen(file, function () {
        fs.chmodSync(file, SOCKET_MODE);
    });
    out.unref();
    return out;
}

module.exports = agent_status_serve;

};
modules["agent/src/agent_status"] = function (module, exports, require) {
const format_duration_ms = require('helpers/format_duration_ms');

// What the agent is doing, as a page somebody can read on the machine itself. It says the same
// things the host's page says about this machine, for the times when the host is exactly what
// cannot be reached.
function agent_status(status, at)
{
    const now = (at === undefined ? Date.now() : at);
    const out = [
        `serviceman-agent ${status.agent}${status.built === null ? '' : ` built ${status.built}`}`,
        `pid ${status.pid}, up ${format_duration_ms(now - status.started_at)}`,
        `machine ${status.machine}`,
        `host ${status.url}`,
        link_text(status, now),
        root_text(status),
    ];
    const keys = Object.keys(status.programs);
    out.push(keys.length === 0 ? 'programs none' : 'programs');
    for (const key of keys) {
        const program = status.programs[key];
        out.push(`  ${key} pid ${program.child.pid} ${program.cwd}`);
    }
    if (status.error !== null) {
        out.push(`last error ${status.error}`);
    }
    out.push(`asked ${new Date(now).toISOString()}`);
    return `${out.join('\n')}\n`;
}

// Whether the machine has a root half, and where it answers. Asked at the same time as
// everything else here, so it is what is true now — a root agent installed a minute ago shows
// up without this one being restarted.
function root_text(status)
{
    if (status.root === true) {
        return `root answers at ${status.root_socket}`;
    }
    return `root none — nothing answers at ${status.root_socket}`;
}

function link_text(status, now)
{
    if (status.phase === 'online') {
        return `link online as remote ${status.remote}, for ${format_duration_ms(now - status.since)}`;
    }
    if (status.phase === 'dialling') {
        return `link dialling since ${new Date(status.since).toISOString()}`;
    }
    return `link ${status.phase}`;
}

module.exports = agent_status;

};
modules["helpers/format_duration_ms"] = function (module, exports, require) {
// 95000 -> '1m 35s'; used by the control page and the waiting page
function format_duration_ms(ms)
{
    const total = Math.max(0, Math.round(ms/1000));
    const days = Math.floor(total/86400);
    const hours = Math.floor(total % 86400/3600);
    const minutes = Math.floor(total % 3600/60);
    const seconds = total % 60;
    const items = [];
    if (days > 0) {
        items.push(`${days}d`);
    }
    if (hours > 0) {
        items.push(`${hours}h`);
    }
    if (minutes > 0) {
        items.push(`${minutes}m`);
    }
    if (items.length < 2) {
        items.push(`${seconds}s`);
    }
    return items.join(' ');
}

module.exports = format_duration_ms;

};
modules["agent/src/agent_uninstall"] = function (module, exports, require) {
const agent_dir = require('agent/src/agent_dir');
const agent_root_ask = require('agent/src/agent_root_ask');
const child_process = require('child_process');
const fs = require('fs');
const path = require('path');

// Takes this agent off this machine: the root half first, then the unit that keeps the session
// half up, then the folder it all lives in. Asked for by the host, once, when the machine has
// been taken out of its config — a machine nobody manages should not go on dialling a host
// that will not have it.
//
// Nothing here is done to an agent running from the repo. The file is read first and must be
// the one the bundler wrote: a checkout is somebody's work, and `rm -rf` on it would be the
// worst kind of obedience.
async function agent_uninstall(options)
{
    const own = path.resolve(process.argv[1]);
    if (bundled(own) === false) {
        return {removed: false, reason: `${own} is not a bundled agent — this one runs from a checkout, and nothing here will delete that`};
    }
    const dir = agent_dir();
    if (path.dirname(own) !== dir) {
        return {removed: false, reason: `${own} does not live in ${dir} — this agent was not put here by the installer`};
    }
    // The root half is asked to take itself away while there is still something to ask with
    const root = await root_gone(options);
    // The rest happens after this process is gone: it is the thing being stopped, and a unit
    // stopping itself never reaches the line after
    const line = `sleep 1; "${dir}/bin/uninstall" >/dev/null 2>&1; rm -rf "${dir}"`;
    const child = child_process.spawn('/bin/sh', ['-c', line], {detached: true, stdio: 'ignore'});
    child.unref();
    return {removed: true, dir, root};
}

async function root_gone(options)
{
    try {
        await agent_root_ask(options, 'uninstall', {});
        return true;
    }
    catch {
        // There was none, or it would not go; the line above says what was taken away
        return false;
    }
}

function bundled(file)
{
    try {
        // Any generation of the bundle: modules["agent_main"] once, modules["agent/index"] now
        return fs.readFileSync(file, 'utf8').includes('modules["agent');
    }
    catch {
        return false;
    }
}

module.exports = agent_uninstall;

};
load("agent/index");
