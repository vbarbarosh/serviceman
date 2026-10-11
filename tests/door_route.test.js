const agent_door_proxy = require('../src/agent/src/agent_door_proxy');
const agent_door_upgrade = require('../src/agent/src/agent_door_upgrade');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const doors_table = require('../src/main/src/helpers/doors_table');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const service_ensure_running = require('../src/main/src/helpers/service_ensure_running');
const service_phase = require('../src/main/src/helpers/service_phase');
const service_stop = require('../src/main/src/helpers/service_stop');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const DOCKER_BIN = path.join(__dirname, 'bin', 'docker');
const TOKEN_LAPTOP = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_SERVER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// The final shape of a door: the name reaches the agent of the machine it is on, that agent asks
// the wall — on another machine here — and only a wall that was reached and said yes lets the
// request on to the service, on that other machine as well. serviceman writes the tables and is
// in none of it: it is shut down halfway, and the door goes on as before.
test('a door routes through the wall to the service itself, and goes on with serviceman down', async function () {
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-doors-state-'));
    process.env.SERVICEMAN_STATE_DIR = state_dir;
    // The wall: a cookie it knows is a yes, and says who; anything else is a no. Its own pages
    // answer on the same name.
    const wall = await server_of(function (req, res) {
        if (req.url === '/auth/sidecar') {
            if (req.headers.cookie === 'session=good') {
                res.writeHead(200, {'x-auth-user': 'user@example.com'});
            }
            else {
                res.writeHead(401);
            }
            res.end();
            return;
        }
        res.end(`the wall's own page ${req.url}`);
    });
    const echoed = [];
    const echo = await server_of(function (req, res) {
        echoed.push({url: req.url, user: req.headers['x-auth-user'] || '', relay: req.headers['x-serviceman-relay'] || ''});
        res.end(`echo ${req.url} for ${req.headers['x-auth-user'] || 'nobody'}`);
    });
    const peer_port = await port_free();
    const running = await serviceman_start({
        remotes: [
            {name: 'laptop', token: TOKEN_LAPTOP, inbound: {'echo.example.com': {service: 'echo', auth: 'authwall'}}},
            {name: 'server', token: TOKEN_SERVER},
        ],
        services: [
            {name: 'authwall', type: 'external', remote: 'server', publish: {host: 'authwall.internal'}, upstream: `127.0.0.1:${wall.address().port}`},
            {name: 'echo', type: 'external', remote: 'server', publish: {host: 'echo.internal'}, upstream: `127.0.0.1:${echo.address().port}`},
        ],
    });
    const dir_laptop = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-door-laptop-'));
    const dir_server = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-door-server-'));
    const agents = [
        agent_start(running.control_port, TOKEN_LAPTOP, {SERVICEMAN_AGENT_DIR: dir_laptop, SERVICEMAN_HTTP_SOCKET_MODE: '0600', SERVICEMAN_PEER_PORT: '0'}),
        agent_start(running.control_port, TOKEN_SERVER, {SERVICEMAN_AGENT_DIR: dir_server, SERVICEMAN_PEER_HOST: '127.0.0.1', SERVICEMAN_PEER_PORT: String(peer_port)}),
    ];
    const door = path.join(dir_laptop, 'http.sock');
    try {
        const laptop = running.app.remote_by_name.laptop;
        const server = running.app.remote_by_name.server;
        // Both machines hold the tables written for them — laptop's naming server as its peer
        await wait_until(() => (server.state.doors_peer !== null) && (laptop.state.doors_told !== null) && (laptop.state.doors_told === doors_table(running.app, laptop).version) && (server.state.doors_told === doors_table(running.app, server).version), 15000);
        assert.deepStrictEqual(Object.keys(doors_table(running.app, laptop).peers), ['server']);

        // Not signed in: the wall says no, and the visitor is sent to sign in on the name asked
        const refused = await fetch_socket(door, 'echo.example.com', '/hello');
        assert.strictEqual(refused.status, 302);
        assert.strictEqual(refused.headers.location, '/auth/sign-in?return=%2Fhello');
        assert.deepStrictEqual(echoed, []);

        // The wall's own pages are the wall's, on that same name
        const own = await fetch_socket(door, 'echo.example.com', '/auth/sign-in');
        assert.strictEqual(own.status, 200);
        assert.match(own.body, /the wall's own page \/auth\/sign-in/);

        // Signed in: through, with who they are in the wall's words — whatever the visitor claimed
        const through = await fetch_socket(door, 'echo.example.com', '/hello', {cookie: 'session=good', 'x-auth-user': 'somebody-else', 'x-serviceman-relay': '0'});
        assert.strictEqual(through.status, 200);
        assert.strictEqual(through.body, 'echo /hello for user@example.com');
        // — and marked as come through a door, whatever the visitor said, so the service can tell
        assert.strictEqual(echoed[echoed.length - 1].relay, '1');

        // serviceman goes away. The door is the agent's, and so is the table it routes by.
        await running.close();
        await wait_until(() => fs.existsSync(door), 1000);
        const alone = await fetch_socket(door, 'echo.example.com', '/still', {cookie: 'session=good'});
        assert.strictEqual(alone.status, 200);
        assert.strictEqual(alone.body, 'echo /still for user@example.com');
        const alone_refused = await fetch_socket(door, 'echo.example.com', '/still');
        assert.strictEqual(alone_refused.status, 302);

        // A name the table does not have is serviceman's to answer, and serviceman is away
        const unknown = await fetch_socket(door, 'other.example.com', '/');
        assert.strictEqual(unknown.status, 503);
        assert.strictEqual(unknown.body, '503 Service Unavailable\n');

        // The wall goes away too: nothing behind it is served, and the service is never touched
        const before = echoed.length;
        await close_server(wall);
        const closed = await fetch_socket(door, 'echo.example.com', '/after', {cookie: 'session=good'});
        // — and the visitor is told no more than that: which wall, and why, is the machine's log
        assert.strictEqual(closed.status, 502);
        assert.strictEqual(closed.body, '502 Bad Gateway\n');
        assert.strictEqual(echoed.length, before);

        // The table is on laptop's disk: an agent that starts again with serviceman still away
        // serves what it served before
        assert.strictEqual(fs.existsSync(path.join(dir_laptop, 'doors', 'table.json')), true);
    }
    finally {
        for (const agent of agents) {
            agent.kill('SIGKILL');
        }
        await running.close();
        echo.close();
        wall.close();
        delete process.env.SERVICEMAN_STATE_DIR;
    }
});

// A service that sleeps is woken by the door itself, and only answered once the program in it
// answers: docker's port takes connections the moment the container starts and drops them
// until then, which a door that trusted the open port would pass on as a 502. serviceman is told
// at once, and its page says the service runs.
test('a door wakes a sleeping service, waits for it to answer, and serviceman sees it run', async function () {
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-doors-state-'));
    process.env.SERVICEMAN_STATE_DIR = state_dir;
    process.env.SERVICEMAN_TEST_STATE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-')), 'docker.json');
    const running = await serviceman_start({
        remotes: [{name: 'laptop', token: TOKEN_LAPTOP, inbound: {'sleepy.example.com': 'sleepy'}}],
        services: [{name: 'sleepy', type: 'docker', remote: 'laptop', publish: {host: 'sleepy.internal', port: 8080}, image: 'demo/sleepy'}],
    });
    const dir_laptop = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-door-laptop-'));
    const agent = agent_start(running.control_port, TOKEN_LAPTOP, {SERVICEMAN_AGENT_DIR: dir_laptop, SERVICEMAN_HTTP_SOCKET_MODE: '0600', SERVICEMAN_PEER_PORT: '0', SERVICEMAN_TEST_DEAF_MS: '800'}, ['--docker', DOCKER_BIN]);
    const door = path.join(dir_laptop, 'http.sock');
    try {
        const laptop = running.app.remote_by_name.laptop;
        const service = running.app.service_by_name.sleepy;
        await wait_until(() => (laptop.state.phase === 'online') && (laptop.state.doors_told !== null) && (laptop.state.doors_told === doors_table(running.app, laptop).version), 15000);
        // It ran once — serviceman made the container — and went to sleep
        await service_ensure_running(running.app, service);
        await service_stop(running.app, service, 'the test puts it to sleep');
        assert.strictEqual(service_phase(service), 'stopped');

        // The door starts it and waits through the time its port drops every connection
        const woken = await fetch_socket(door, 'sleepy.example.com', '/');
        assert.strictEqual(woken.status, 200);

        // And serviceman is told, so the page says it runs
        await wait_until(() => service_phase(service) === 'running', 5000);
        assert.strictEqual(running.app.log_lines.some(v => v.includes('[service_adopt_ok] service=sleepy')), true);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
        delete process.env.SERVICEMAN_STATE_DIR;
    }
});

// A far end that takes no connection — a machine asleep, or off the tailnet — is a 502 at once,
// for a request and for a websocket, not a wait until the system gives up minutes later.
// 192.0.2.1 is an address nothing answers on.
test('a door answers 502 at once when the far end takes no connection', async function () {
    const connect_ms = agent_door_proxy.connect_ms;
    agent_door_proxy.connect_ms = 300;
    const away = {host: '192.0.2.1', port: 9};
    const front = await server_of(function (req, res) {
        agent_door_proxy(req, res, away, {});
    });
    front.on('upgrade', function (req, socket, head) {
        agent_door_upgrade(req, socket, head, away, {});
    });
    try {
        const time0 = Date.now();
        const answer = await fetch_port(front.address().port, {});
        assert.strictEqual(answer.status, 502);
        assert.ok(Date.now() - time0 < 2000);

        const time1 = Date.now();
        const closed = await fetch_port(front.address().port, {connection: 'upgrade', upgrade: 'websocket'});
        assert.strictEqual(closed.status, 'closed');
        assert.ok(Date.now() - time1 < 2000);
    }
    finally {
        agent_door_proxy.connect_ms = connect_ms;
        await close_server(front);
    }
});

async function serviceman_start(json)
{
    const config = config_from_json(Object.assign({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}}, json), __dirname);
    const app = app_from_config(config);
    const servers = await server_start(app);
    let closed = false;
    return {
        app,
        control_port: servers.control.address().port,
        close: async function () {
            if (closed) {
                return;
            }
            closed = true;
            for (const remote of app.remotes) {
                if (remote.state.socket !== null) {
                    remote.state.socket.destroy();
                }
            }
            for (const door of [servers.server, servers.control, servers.socket]) {
                if ((door !== null) && (door !== undefined)) {
                    door.close();
                    door.closeAllConnections();
                }
            }
            for (const timer of Object.values(app.timers || {})) {
                clearInterval(timer);
            }
        },
    };
}

function agent_start(control_port, token, env, extra)
{
    const argv = [AGENT, '--url', `http://127.0.0.1:${control_port}`, '--token', token].concat((extra === undefined) ? [] : extra);
    const out = child_process.spawn(process.execPath, argv, {stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, env)});
    out.stdout.resume();
    out.stderr.resume();
    return out;
}

function server_of(handler)
{
    const server = http.createServer(handler);
    return new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', function () {
            resolve(server);
        });
    });
}

function close_server(server)
{
    return new Promise(function (resolve) {
        server.close(resolve);
        server.closeAllConnections();
    });
}

function port_free()
{
    return new Promise(function (resolve) {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', function () {
            const port = server.address().port;
            server.close(function () {
                resolve(port);
            });
        });
    });
}

function fetch_socket(file, host, path_asked, headers)
{
    return new Promise(function (resolve, reject) {
        const req = http.request({socketPath: file, path: path_asked, headers: Object.assign({host}, headers)}, function (res) {
            const body = [];
            res.on('data', v => body.push(v));
            res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(body).toString('utf8')}));
        });
        req.on('error', reject);
        req.end();
    });
}

// {status, body}, or {status: 'closed'} for a connection that ended with no answer
function fetch_port(port, headers)
{
    return new Promise(function (resolve) {
        const req = http.request({host: '127.0.0.1', port, path: '/', headers}, function (res) {
            const body = [];
            res.on('data', v => body.push(v));
            res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(body).toString('utf8')}));
        });
        req.on('upgrade', function (res, socket) {
            socket.destroy();
            resolve({status: res.statusCode});
        });
        req.on('error', function () {
            resolve({status: 'closed'});
        });
        req.end();
    });
}

async function wait_until(ready, timeout_ms)
{
    const deadline = Date.now() + timeout_ms;
    for (;;) {
        if (ready()) {
            return;
        }
        if (Date.now() >= deadline) {
            throw new Error('the condition never came true');
        }
        await timers.setTimeout(25);
    }
}
