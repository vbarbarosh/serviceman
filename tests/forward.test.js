const app_apply_config = require('../src/main/src/helpers/app_apply_config');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const link_read = require('../src/helpers/link_read');
const net = require('net');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const stream = require('stream');
const test = require('node:test');
const timers = require('timers/promises');
const tunnel_inbound = require('../src/main/src/helpers/tunnel_inbound');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const TOKEN_LAPTOP = 'cccccccccccccccccccccccccccccccc';
const TOKEN_VPS = 'dddddddddddddddddddddddddddddddd';

// The author's case: a port on a VPS shows up as a socket file on the laptop. Bytes go both
// ways through both links, the socket is the agent's user's alone, and the page sees the counts.
test('a forward carries a laptop socket to a port on another machine, both ways', async function () {
    const echo = await echo_server({port: 0, host: '127.0.0.1'});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-'));
    const sock = path.join(dir, 'loki.sock');
    const running = await serviceman_start([
        {name: 'loki', from: {remote: 'laptop', socket: sock}, to: {remote: 'vps1', port: echo.address().port}},
    ]);
    const agents = agents_start(running);
    try {
        await wait_listening(running, 'loki');
        assert.strictEqual(fs.statSync(sock).mode & 0o777, 0o600, 'nobody but the agent\'s user may connect');

        assert.strictEqual(await say_through({path: sock}, 'hello'), 'echo: hello');
        assert.strictEqual(await say_through({path: sock}, 'x'.repeat(600000)), `echo: ${'x'.repeat(600000)}`, 'more than a window each way');

        await wait_until(() => running.app.forward_counts.loki.open === 0);
        const view = (await state_read(running)).forwards[0];
        assert.strictEqual(view.problem, null);
        assert.strictEqual(view.state, 'ready');
        assert.strictEqual(view.at, sock);
        assert.strictEqual(view.total, 2);
        assert.strictEqual(view.bytes_to, 5 + 600000);
        assert.strictEqual(view.bytes_from, 11 + 600006);
    }
    finally {
        agents_stop(agents);
        await running.close();
        echo.close();
    }
});

// The other way round, with a port at the near end: socket → port and port → socket are one thing
test('a forward listens on a loopback port and reaches a socket file over there', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-'));
    const far = path.join(dir, 'far.sock');
    const echo = await echo_server({path: far});
    const port = await port_free();
    const running = await serviceman_start([
        {name: 'back', from: {remote: 'vps1', port}, to: {remote: 'laptop', socket: far}},
    ]);
    const agents = agents_start(running);
    try {
        await wait_listening(running, 'back');
        assert.strictEqual(await say_through({host: '127.0.0.1', port}, 'ping'), 'echo: ping');
    }
    finally {
        agents_stop(agents);
        await running.close();
        echo.close();
    }
});

// What breaks says so at once, where it broke: nothing hangs, and the page names the reason
test('a forward to a machine that is away closes each connection at once and says why', async function () {
    const echo = await echo_server({port: 0, host: '127.0.0.1'});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-'));
    const sock = path.join(dir, 'loki.sock');
    const running = await serviceman_start([
        {name: 'loki', from: {remote: 'laptop', socket: sock}, to: {remote: 'vps1', port: echo.address().port}},
    ]);
    const agents = agents_start(running);
    try {
        await wait_listening(running, 'loki');
        agents.vps1.kill('SIGKILL');
        await wait_until(() => running.app.remote_by_name.vps1.state.phase === 'offline');

        assert.strictEqual(await say_through({path: sock}, 'hello'), '', 'closed with nothing said');
        const view = (await state_read(running)).forwards[0];
        assert.strictEqual(view.problem, 'vps1 is offline');
        assert.strictEqual(view.state, 'to_offline');
        assert.strictEqual(view.error, 'vps1 is offline');
        assert.strictEqual(running.app.log_lines.some(v => /\[forward_error\] forward=loki reason="vps1 is offline"/.test(v)), true);

        // A port nothing answers on over there: refused there, and the reason comes back
        echo.close();
        agents.vps1 = agent_start(running.control_port, TOKEN_VPS);
        await wait_until(() => running.app.remote_by_name.vps1.state.phase === 'online');
        assert.strictEqual(await say_through({path: sock}, 'hello'), '');
        await wait_until(() => /^vps1: .*ECONNREFUSED/.test(running.app.forward_counts.loki.error));
    }
    finally {
        agents_stop(agents);
        await running.close();
        echo.close();
    }
});

// The socket outlives the link: with serviceman gone the file is still there, and a connect is
// closed at once rather than left hanging
test('a forward goes on listening while the link is down, and refuses at once', async function () {
    const echo = await echo_server({port: 0, host: '127.0.0.1'});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-'));
    const sock = path.join(dir, 'loki.sock');
    const running = await serviceman_start([
        {name: 'loki', from: {remote: 'laptop', socket: sock}, to: {remote: 'vps1', port: echo.address().port}},
    ]);
    const agents = agents_start(running);
    try {
        await wait_listening(running, 'loki');
        await running.close();
        await timers.setTimeout(200);
        assert.strictEqual(fs.existsSync(sock), true);
        const time0 = Date.now();
        assert.strictEqual(await say_through({path: sock}, 'hello'), '');
        assert.strictEqual(Date.now() - time0 < 1000, true, 'refused at once');
    }
    finally {
        agents_stop(agents);
        echo.close();
    }
});

// A socket file left by a process that is gone is taken; one another program answers on is not
// — an `ssh -L` doing the same job keeps it — and the page says which
test('a stale socket file is taken over, a live one is left to its program', async function () {
    const echo = await echo_server({port: 0, host: '127.0.0.1'});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-'));
    const stale = path.join(dir, 'stale.sock');
    const live = path.join(dir, 'live.sock');
    await stale_socket(stale);
    const holder = await echo_server({path: live});
    const running = await serviceman_start([
        {name: 'stale', from: {remote: 'laptop', socket: stale}, to: {remote: 'vps1', port: echo.address().port}},
        {name: 'live', from: {remote: 'laptop', socket: live}, to: {remote: 'vps1', port: echo.address().port}},
    ]);
    const agents = agents_start(running);
    try {
        await wait_listening(running, 'stale');
        assert.strictEqual(await say_through({path: stale}, 'a'), 'echo: a');
        const view = (await state_read(running)).forwards.find(v => v.name === 'live');
        assert.strictEqual(view.problem, `laptop cannot listen: ${live} is answered by another program`);
        assert.strictEqual(view.state, 'cannot_listen');
        assert.strictEqual(view.at, null);

        // Its program goes, and the next minute's telling takes the file
        holder.close();
        running.app.remote_by_name.laptop.state.forwards_told = null;
        await require('../src/main/src/helpers/forwards_tell')(running.app);
        await wait_listening(running, 'live');
    }
    finally {
        agents_stop(agents);
        await running.close();
        echo.close();
        holder.close();
    }
});

// The config is the list: a forward taken out of it stops listening and its file goes, and one
// set aside is not listened for at all
test('a forward taken out of the config or set aside closes its socket', async function () {
    const echo = await echo_server({port: 0, host: '127.0.0.1'});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-'));
    const sock = path.join(dir, 'loki.sock');
    const forward = {name: 'loki', from: {remote: 'laptop', socket: sock}, to: {remote: 'vps1', port: echo.address().port}};
    const running = await serviceman_start([forward]);
    const agents = agents_start(running);
    try {
        await wait_listening(running, 'loki');
        await app_apply_config(running.app, config_of([Object.assign({}, forward, {off: true})]));
        await wait_until(() => fs.existsSync(sock) === false);
        const aside = (await state_read(running)).forwards[0];
        assert.deepStrictEqual([aside.state, aside.problem], ['aside', 'set aside']);

        await app_apply_config(running.app, config_of([forward]));
        await wait_listening(running, 'loki');
        assert.strictEqual(await say_through({path: sock}, 'back'), 'echo: back');

        await app_apply_config(running.app, config_of([]));
        await wait_until(() => fs.existsSync(sock) === false);
        assert.deepStrictEqual((await state_read(running)).forwards, []);
    }
    finally {
        agents_stop(agents);
        await running.close();
        echo.close();
    }
});

// A machine may open only its own forwards: naming another machine's is asking this host to dial
// for it, and is refused without a stream ever being opened
test('a machine that names a forward that is not its own is refused', async function () {
    const config = config_of([{name: 'loki', from: {remote: 'laptop', port: 9999}, to: {remote: 'vps1', port: 3100}}]);
    const app = app_from_config(config);
    app.servers = {};
    const frames = [];
    const link = new stream.PassThrough();
    link_read(link, function (kind, body) {
        frames.push({kind, id: body.readUInt32BE(0), said: JSON.parse(body.subarray(4).toString('utf8'))});
    });
    const vps1 = app.remote_by_name.vps1;
    vps1.state.socket = link;
    vps1.state.phase = 'online';
    tunnel_inbound(app, vps1, open_body(7, {forward: 'loki'}));
    tunnel_inbound(app, vps1, open_body(9, {forward: 'nothing'}));
    await wait_until(() => frames.length === 2);
    assert.deepStrictEqual(frames, [
        {kind: 'x', id: 7, said: {code: 'EBADTARGET', message: 'vps1 has no forward named loki'}},
        {kind: 'x', id: 9, said: {code: 'EBADTARGET', message: 'vps1 has no forward named nothing'}},
    ]);
    assert.deepStrictEqual(vps1.state.streams, {});
});

test('the page writes the forwards into the config file', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-config-'));
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: remotes_json(), services: []}));
    const config = config_from_json(JSON.parse(fs.readFileSync(config_path, 'utf8')), dir);
    config.path = config_path;
    const app = app_from_config(config);
    const servers = await server_start(app);
    const port = servers.control.address().port;
    try {
        const forwards = [{name: 'loki', from: {remote: 'laptop', socket: '~/repos/loki.sock'}, to: {remote: 'vps1', port: 3100}}];
        const written = await fetch_host({port, host: '127.0.0.1', path: '/api/v1/forwards', method: 'PUT', body: JSON.stringify({forwards})});
        assert.strictEqual(written.status, 200);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(config_path, 'utf8')).forwards, forwards);
        assert.strictEqual(app.config.forwards[0].from.socket, '~/repos/loki.sock');

        const bad = await fetch_host({port, host: '127.0.0.1', path: '/api/v1/forwards', method: 'PUT', body: JSON.stringify({forwards: [{name: 'x', from: {remote: 'phone', port: 1}, to: {remote: 'vps1', port: 2}}]})});
        assert.strictEqual(bad.status, 400);
        assert.strictEqual(JSON.parse(bad.body).error, 'forwards[0].from.remote: no remote named "phone" is in the config');
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(config_path, 'utf8')).forwards, forwards, 'a refused list leaves the file as it was');

        const emptied = await fetch_host({port, host: '127.0.0.1', path: '/api/v1/forwards', method: 'PUT', body: JSON.stringify({forwards: []})});
        assert.strictEqual(emptied.status, 200);
        assert.strictEqual(JSON.parse(fs.readFileSync(config_path, 'utf8')).forwards, undefined);
    }
    finally {
        servers.control.close();
        servers.server.close();
    }
});

test('the config says what is wrong with a forward, in its own words', function () {
    const cases = [
        [{name: 'Loki', from: {remote: 'laptop', port: 1}, to: {remote: 'vps1', port: 2}}, 'forwards[0].name: lowercase letters, digits, - and _ (got "Loki")'],
        [{name: 'a', from: {remote: 'laptop'}, to: {remote: 'vps1', port: 2}}, 'forwards[0].from: one of "port" or "socket"'],
        [{name: 'a', from: {remote: 'laptop', port: 1, socket: '/a.sock'}, to: {remote: 'vps1', port: 2}}, 'forwards[0].from: one of "port" or "socket"'],
        [{name: 'a', from: {remote: 'laptop', port: 70000}, to: {remote: 'vps1', port: 2}}, 'forwards[0].from.port: a port from 1 to 65535 (got 70000)'],
        [{name: 'a', from: {remote: 'laptop', socket: 'loki.sock'}, to: {remote: 'vps1', port: 2}}, 'forwards[0].from.socket: a path from / or ~/, of at most 100 characters (got "loki.sock")'],
        [{name: 'a', from: {remote: 'laptop', host: '0.0.0.0', port: 1}, to: {remote: 'vps1', port: 2}}, 'forwards[0].from.host: a forward listens on its machine\'s loopback and nowhere else'],
        [{name: 'a', from: {remote: 'laptop', port: 1}, to: {remote: 'vps1', socket: '/a.sock', host: '10.0.0.5'}}, 'forwards[0].to.host: a host goes with a port, not with a socket'],
        [{name: 'a', from: {remote: 'laptop', port: 1}, to: {remote: 'vps1', port: 2, user: 'root'}}, 'forwards[0].to.user: not a field of a forward\'s end — remote, port, socket, host'],
        [{name: 'a', from: {remote: 'nobody', port: 1}, to: {remote: 'vps1', port: 2}}, 'forwards[0].from.remote: no remote named "nobody" is in the config'],
    ];
    for (const [forward, message] of cases) {
        assert.throws(() => config_of([forward]), {message});
    }
    const twice = [
        {name: 'a', from: {remote: 'laptop', port: 1}, to: {remote: 'vps1', port: 2}},
        {name: 'a', from: {remote: 'laptop', port: 3}, to: {remote: 'vps1', port: 2}},
    ];
    assert.throws(() => config_of(twice), {message: 'forwards[1].name: "a" is used twice'});
    const same_place = [
        {name: 'a', from: {remote: 'laptop', port: 1}, to: {remote: 'vps1', port: 2}},
        {name: 'b', from: {remote: 'laptop', port: 1}, to: {remote: 'vps1', port: 3}},
    ];
    assert.throws(() => config_of(same_place), {message: 'forwards[1].from: a already listens there'});
    // No forwards is an empty list, and an end keeps every field, null where it was not written
    assert.deepStrictEqual(config_of([]).forwards, []);
    assert.deepStrictEqual(config_of([{name: 'a', from: {remote: 'laptop', socket: '~/a.sock'}, to: {remote: 'vps1', host: '10.0.0.5', port: 2}}]).forwards, [
        {name: 'a', from: {remote: 'laptop', port: null, socket: '~/a.sock', host: null}, to: {remote: 'vps1', port: 2, socket: null, host: '10.0.0.5'}, off: false},
    ]);
});

function open_body(id, target)
{
    const json = Buffer.from(JSON.stringify(target));
    const out = Buffer.alloc(4 + json.length);
    out.writeUInt32BE(id, 0);
    json.copy(out, 4);
    return out;
}

function remotes_json()
{
    return [{name: 'laptop', token: TOKEN_LAPTOP}, {name: 'vps1', token: TOKEN_VPS}];
}

function config_of(forwards)
{
    return config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: remotes_json(),
        forwards,
        services: [],
    }, __dirname);
}

async function serviceman_start(forwards)
{
    const app = app_from_config(config_of(forwards));
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
            for (const door of [servers.server, servers.control]) {
                door.close();
                door.closeAllConnections();
            }
        },
    };
}

// Two machines, each an agent with a folder of its own
function agents_start(running)
{
    return {
        laptop: agent_start(running.control_port, TOKEN_LAPTOP),
        vps1: agent_start(running.control_port, TOKEN_VPS),
    };
}

function agents_stop(agents)
{
    for (const name of Object.keys(agents)) {
        agents[name].kill('SIGKILL');
    }
}

function agent_start(control_port, token)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-agent-'));
    const argv = [AGENT, '--url', `http://127.0.0.1:${control_port}`, '--token', token];
    const out = child_process.spawn(process.execPath, argv, {stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: dir})});
    out.stdout.resume();
    out.stderr.resume();
    return out;
}

async function wait_listening(running, name)
{
    await wait_until(function () {
        const said = running.app.remote_by_name[running.app.config.forwards.find(v => v.name === name).from.remote].state.forwards_said;
        return (said !== null) && (said[name] !== undefined) && (said[name].error === null) && (running.app.remote_by_name.vps1.state.phase === 'online') && (running.app.remote_by_name.laptop.state.phase === 'online');
    });
}

// Writes the text, says it is done, and answers with all that came back before the close
function say_through(where, text)
{
    return new Promise(function (resolve) {
        const socket = net.connect(where);
        const chunks = [];
        socket.on('connect', function () {
            socket.end(text);
        });
        socket.on('data', function (chunk) {
            chunks.push(chunk);
        });
        socket.on('error', function () {
            // A close is the answer here; the error says nothing more
        });
        socket.on('close', function () {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
    });
}

// Answers with `echo: ` and all it was sent, once the sender says it is done
function echo_server(where)
{
    return new Promise(function (resolve) {
        const server = net.createServer(function (socket) {
            const chunks = [];
            socket.on('data', function (chunk) {
                chunks.push(chunk);
            });
            socket.on('end', function () {
                socket.end(`echo: ${Buffer.concat(chunks).toString('utf8')}`);
            });
            socket.on('error', function () {
                socket.destroy();
            });
        });
        server.listen(where, function () {
            resolve(server);
        });
    });
}

// A socket file whose process is gone: listened on, then left behind by a child that is killed
async function stale_socket(file)
{
    const child = child_process.spawn(process.execPath, ['-e', `require('net').createServer().listen(${JSON.stringify(file)})`]);
    await wait_until(() => fs.existsSync(file));
    child.kill('SIGKILL');
    await new Promise(v => child.on('close', v));
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

async function state_read(running)
{
    const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/status'});
    return JSON.parse(answer.body);
}

async function wait_until(ready, timeout_ms)
{
    const deadline = Date.now() + ((timeout_ms === undefined) ? 10000 : timeout_ms);
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
