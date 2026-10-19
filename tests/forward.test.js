const app_apply_config = require('../src/main/src/helpers/app_apply_config');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const forwards_here = require('../src/main/src/helpers/forwards_here');
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
test('a forward brings a port of another machine to a socket on the laptop, both ways', async function () {
    const echo = await echo_server({port: 0, host: '127.0.0.1'});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-'));
    const sock = path.join(dir, 'loki.sock');
    const running = await serviceman_start([
        {label: 'Loki on vps1.example.com/loki.sock', from: {remote: 'vps1', port: echo.address().port}, to: {remote: 'laptop', socket: sock}},
    ]);
    const agents = agents_start(running);
    try {
        // A label is any text: the agent, the counts and the page know the forward by it
        await wait_listening(running, 'Loki on vps1.example.com/loki.sock');
        assert.strictEqual(fs.statSync(sock).mode & 0o777, 0o600, 'nobody but the agent\'s user may connect');

        assert.strictEqual(await say_through({path: sock}, 'hello'), 'echo: hello');
        assert.strictEqual(await say_through({path: sock}, 'x'.repeat(600000)), `echo: ${'x'.repeat(600000)}`, 'more than a window each way');

        await wait_until(() => running.app.forward_counts['Loki on vps1.example.com/loki.sock'].open === 0);
        const view = (await state_read(running)).forwards[0];
        assert.strictEqual(view.label, 'Loki on vps1.example.com/loki.sock');
        assert.strictEqual(view.problem, null);
        assert.strictEqual(view.state, 'ready');
        assert.strictEqual(view.at, sock);
        assert.strictEqual(view.total, 2);
        assert.strictEqual(view.bytes_sent, 5 + 600000);
        assert.strictEqual(view.bytes_back, 11 + 600006);
    }
    finally {
        agents_stop(agents);
        await running.close();
        echo.close();
    }
});

// The other way round, a socket brought to a port: socket → port and port → socket are one thing
test('a forward brings a socket file over there to a loopback port', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-'));
    const far = path.join(dir, 'far.sock');
    const echo = await echo_server({path: far});
    const port = await port_free();
    const running = await serviceman_start([
        {label: 'back', from: {remote: 'laptop', socket: far}, to: {remote: 'vps1', port}},
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
test('a forward from a machine that is away closes each connection at once and says why', async function () {
    const echo = await echo_server({port: 0, host: '127.0.0.1'});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-'));
    const sock = path.join(dir, 'loki.sock');
    const running = await serviceman_start([
        {label: 'loki', from: {remote: 'vps1', port: echo.address().port}, to: {remote: 'laptop', socket: sock}},
    ]);
    const agents = agents_start(running);
    try {
        await wait_listening(running, 'loki');
        agents.vps1.kill('SIGKILL');
        await wait_until(() => running.app.remote_by_name.vps1.state.phase === 'offline');

        assert.strictEqual(await say_through({path: sock}, 'hello'), '', 'closed with nothing said');
        const view = (await state_read(running)).forwards[0];
        assert.strictEqual(view.problem, 'vps1 is offline');
        assert.strictEqual(view.state, 'from_offline');
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
        {label: 'loki', from: {remote: 'vps1', port: echo.address().port}, to: {remote: 'laptop', socket: sock}},
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
        {label: 'stale', from: {remote: 'vps1', port: echo.address().port}, to: {remote: 'laptop', socket: stale}},
        {label: 'live', from: {remote: 'vps1', port: echo.address().port}, to: {remote: 'laptop', socket: live}},
    ]);
    const agents = agents_start(running);
    try {
        await wait_listening(running, 'stale');
        assert.strictEqual(await say_through({path: stale}, 'a'), 'echo: a');
        const view = (await state_read(running)).forwards.find(v => v.label === 'live');
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
    const forward = {label: 'loki', from: {remote: 'vps1', port: echo.address().port}, to: {remote: 'laptop', socket: sock}};
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
    const config = config_of([{label: 'loki', from: {remote: 'vps1', port: 3100}, to: {remote: 'laptop', port: 9999}}]);
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
        const forwards = [{label: 'loki', from: {remote: 'vps1', port: 3100}, to: {remote: 'laptop', socket: '~/repos/loki.sock'}}];
        const written = await fetch_host({port, host: '127.0.0.1', path: '/api/v1/forwards', method: 'PUT', body: JSON.stringify({forwards})});
        assert.strictEqual(written.status, 200);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(config_path, 'utf8')).forwards, forwards);
        assert.strictEqual(app.config.forwards[0].to.socket, '~/repos/loki.sock');

        const bad = await fetch_host({port, host: '127.0.0.1', path: '/api/v1/forwards', method: 'PUT', body: JSON.stringify({forwards: [{label: 'x', from: {remote: 'vps1', port: 2}, to: {remote: 'phone', port: 1}}]})});
        assert.strictEqual(bad.status, 400);
        assert.strictEqual(JSON.parse(bad.body).error, 'forwards[0].to.remote: no remote named "phone" is in the config');
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
        [{from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 1}}, 'forwards[0].label: any text of one line, at most 100 characters, with no spaces around it (got undefined)'],
        [{label: '', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 1}}, 'forwards[0].label: any text of one line, at most 100 characters, with no spaces around it (got "")'],
        [{label: 7, from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 1}}, 'forwards[0].label: any text of one line, at most 100 characters, with no spaces around it (got 7)'],
        [{label: ' loki', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 1}}, 'forwards[0].label: any text of one line, at most 100 characters, with no spaces around it (got " loki")'],
        [{label: 'two\nlines', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 1}}, 'forwards[0].label: any text of one line, at most 100 characters, with no spaces around it (got "two\\nlines")'],
        [{label: 'x'.repeat(101), from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 1}}, `forwards[0].label: any text of one line, at most 100 characters, with no spaces around it (got "${'x'.repeat(101)}")`],
        [{label: 'a', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop'}}, 'forwards[0].to: one of "port" or "socket"'],
        [{label: 'a', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 1, socket: '/a.sock'}}, 'forwards[0].to: one of "port" or "socket"'],
        [{label: 'a', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 70000}}, 'forwards[0].to.port: a port from 1 to 65535 (got 70000)'],
        [{label: 'a', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', socket: 'loki.sock'}}, 'forwards[0].to.socket: a path from / or ~/, of at most 100 characters (got "loki.sock")'],
        [{label: 'a', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', host: '0.0.0.0', port: 1}}, 'forwards[0].to.host: a forward shows up on its machine\'s loopback and nowhere else'],
        [{label: 'a', from: {remote: 'vps1', socket: '/a.sock', host: '10.0.0.5'}, to: {remote: 'laptop', port: 1}}, 'forwards[0].from.host: a host goes with a port, not with a socket'],
        [{label: 'a', from: {remote: 'vps1', port: 2, user: 'root'}, to: {remote: 'laptop', port: 1}}, 'forwards[0].from.user: not a field of a forward\'s end — remote, here, port, socket, host'],
        [{label: 'a', from: {remote: 'vps1', port: 2}, to: {remote: 'nobody', port: 1}}, 'forwards[0].to.remote: no remote named "nobody" is in the config'],
    ];
    for (const [forward, message] of cases) {
        assert.throws(() => config_of([forward]), {message});
    }
    const twice = [
        {label: 'a', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 1}},
        {label: 'a', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 3}},
    ];
    assert.throws(() => config_of(twice), {message: 'forwards[1].label: "a" is used twice'});
    const same_place = [
        {label: 'a', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 1}},
        {label: 'b', from: {remote: 'vps1', port: 3}, to: {remote: 'laptop', port: 1}},
    ];
    assert.throws(() => config_of(same_place), {message: 'forwards[1].to: "a" already listens there'});
    // A label is any text of one line, up to 100 characters; a config from before labels says `name`
    const labels = ['Loki on prod', 'vps1.example.com/loki.sock', 'Логи · 3100', 'x'.repeat(100)];
    assert.deepStrictEqual(config_of(labels.map((v, index) => ({label: v, from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: index + 1}}))).forwards.map(v => v.label), labels);
    assert.strictEqual(config_of([{name: 'loki', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 1}}]).forwards[0].label, 'loki');
    // No forwards is an empty list, and an end keeps every field, null where it was not written
    assert.deepStrictEqual(config_of([]).forwards, []);
    assert.deepStrictEqual(config_of([{label: 'a', from: {remote: 'vps1', host: '10.0.0.5', port: 2}, to: {remote: 'laptop', socket: '~/a.sock'}}]).forwards, [
        {label: 'a', from: {remote: 'vps1', here: false, port: 2, socket: null, host: '10.0.0.5'}, to: {remote: 'laptop', here: false, port: null, socket: '~/a.sock', host: null}, off: false},
    ]);
});

// serviceman itself is the machine it shows up on: no agent there, a socket file inside its
// state dir and a port on its loopback, both carried to a port on vps1, and counted the same
test('a forward shows up on serviceman itself, as a socket in its state dir and as a port', async function () {
    const echo = await echo_server({port: 0, host: '127.0.0.1'});
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-state-'));
    const sock = path.join(state_dir, 'sockets', 'loki.sock');
    const port = await port_free();
    const running = await serviceman_start([
        {label: 'loki', from: {remote: 'vps1', port: echo.address().port}, to: {here: true, socket: 'sockets/loki.sock'}},
        {label: 'loki-port', from: {remote: 'vps1', port: echo.address().port}, to: {here: true, port}},
    ], state_dir);
    const agents = {vps1: agent_start(running.control_port, TOKEN_VPS)};
    try {
        await wait_here(running, 'loki');
        assert.strictEqual(fs.statSync(sock).mode & 0o777, 0o600, 'nobody but serviceman\'s user may connect');

        assert.strictEqual(await say_through({path: sock}, 'hello'), 'echo: hello');
        assert.strictEqual(await say_through({path: sock}, 'x'.repeat(600000)), `echo: ${'x'.repeat(600000)}`, 'more than a window each way');
        assert.strictEqual(await say_through({host: '127.0.0.1', port}, 'ping'), 'echo: ping');

        await wait_until(() => running.app.forward_counts.loki.open === 0);
        const views = (await state_read(running)).forwards;
        const view = views.find(v => v.label === 'loki');
        assert.deepStrictEqual([view.state, view.problem, view.at], ['ready', null, sock]);
        assert.deepStrictEqual(view.to, {remote: null, here: true, port: null, socket: 'sockets/loki.sock', host: null});
        assert.deepStrictEqual([view.total, view.bytes_sent, view.bytes_back], [2, 5 + 600000, 11 + 600006]);
        assert.strictEqual(views.find(v => v.label === 'loki-port').at, `127.0.0.1:${port}`);
        assert.strictEqual(running.app.log_lines.some(v => v.includes('[forward_here_listen] forward=loki ')), true);
    }
    finally {
        agents_stop(agents);
        await running.close();
        echo.close();
    }
});

test('a forward on serviceman itself closes each connection at once while the service\'s machine is away', async function () {
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-state-'));
    const sock = path.join(state_dir, 'loki.sock');
    const running = await serviceman_start([
        {label: 'loki', from: {remote: 'vps1', port: 3100}, to: {here: true, socket: 'loki.sock'}},
    ], state_dir);
    try {
        await wait_until(() => (running.app.forwards_here.loki !== undefined) && (running.app.forwards_here.loki.error === null));
        const time0 = Date.now();
        assert.strictEqual(await say_through({path: sock}, 'hello'), '', 'closed with nothing said');
        assert.strictEqual(Date.now() - time0 < 1000, true, 'refused at once');
        const view = (await state_read(running)).forwards[0];
        assert.deepStrictEqual([view.state, view.problem, view.error], ['from_offline', 'vps1 is offline', 'vps1 is offline']);
        assert.strictEqual(running.app.log_lines.some(v => /\[forward_error\] forward=loki reason="vps1 is offline"/.test(v)), true);
    }
    finally {
        await running.close();
    }
});

// The config is the list here too: set aside, the file goes; on again, it is back; changed, it
// moves; taken out, it goes for good
test('a forward on serviceman itself follows the config, its socket file with it', async function () {
    const echo = await echo_server({port: 0, host: '127.0.0.1'});
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-state-'));
    const sock = path.join(state_dir, 'loki.sock');
    const moved = path.join(state_dir, 'deep', 'er', 'loki.sock');
    const forward = {label: 'loki', from: {remote: 'vps1', port: echo.address().port}, to: {here: true, socket: 'loki.sock'}};
    const running = await serviceman_start([forward], state_dir);
    const agents = {vps1: agent_start(running.control_port, TOKEN_VPS)};
    try {
        await wait_here(running, 'loki');
        await app_apply_config(running.app, config_of([Object.assign({}, forward, {off: true})]));
        await wait_until(() => fs.existsSync(sock) === false);
        const aside = (await state_read(running)).forwards[0];
        assert.deepStrictEqual([aside.state, aside.problem, aside.at], ['aside', 'set aside', null]);
        assert.strictEqual(running.app.log_lines.some(v => v.includes('[forward_here_close] forward=loki ')), true);

        await app_apply_config(running.app, config_of([forward]));
        await wait_here(running, 'loki');
        assert.strictEqual(await say_through({path: sock}, 'back'), 'echo: back');

        await app_apply_config(running.app, config_of([Object.assign({}, forward, {to: {here: true, socket: 'deep/er/loki.sock'}})]));
        await wait_until(() => fs.existsSync(moved) && (fs.existsSync(sock) === false));
        await wait_here(running, 'loki');
        assert.strictEqual(await say_through({path: moved}, 'moved'), 'echo: moved');

        await app_apply_config(running.app, config_of([]));
        await wait_until(() => fs.existsSync(moved) === false);
        assert.deepStrictEqual(running.app.forwards_here, {});
    }
    finally {
        agents_stop(agents);
        await running.close();
        echo.close();
    }
});

// What a crash left is taken over; a file that is not a socket is never deleted, and the page
// says why it cannot listen
test('a forward on serviceman itself takes a stale socket and leaves a file alone', async function () {
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-state-'));
    const stale = path.join(state_dir, 'stale.sock');
    const file = path.join(state_dir, 'counters.json');
    await stale_socket(stale);
    fs.writeFileSync(file, '{}');
    const running = await serviceman_start([
        {label: 'stale', from: {remote: 'vps1', port: 3100}, to: {here: true, socket: 'stale.sock'}},
        {label: 'file', from: {remote: 'vps1', port: 3100}, to: {here: true, socket: 'counters.json'}},
    ], state_dir);
    try {
        assert.strictEqual(running.app.forwards_here.stale.error, null);
        assert.strictEqual(fs.lstatSync(stale).isSocket(), true);
        const view = (await state_read(running)).forwards.find(v => v.label === 'file');
        assert.deepStrictEqual([view.state, view.problem, view.at], ['cannot_listen', `serviceman cannot listen: ${file} is there and is not a socket`, null]);
        assert.strictEqual(fs.readFileSync(file, 'utf8'), '{}');
        // Tried again on the minute, it says the same reason once in the log
        await forwards_here(running.app);
        assert.strictEqual(running.app.log_lines.filter(v => v.includes('[forward_here_listen_error] forward=file ')).length, 1);
    }
    finally {
        await running.close();
    }
});

test('the config says where serviceman itself may be in a forward', function () {
    const from = {remote: 'vps1', port: 2};
    const cases = [
        [{label: 'a', from: {here: true, port: 2}, to: {remote: 'laptop', port: 1}}, 'forwards[0].from.here: the service is on a machine with an agent — serviceman itself may only be where a forward shows up, in "to"'],
        [{label: 'a', from, to: {here: true, remote: 'laptop', port: 1}}, 'forwards[0].to: one of "here" or "remote", not both'],
        [{label: 'a', from, to: {here: false, port: 1}}, 'forwards[0].to.here: true, or left out (got false)'],
        [{label: 'a', from, to: {here: true}}, 'forwards[0].to: one of "port" or "socket"'],
        [{label: 'a', from, to: {here: true, host: '127.0.0.1', port: 1}}, 'forwards[0].to.host: a forward shows up on its machine\'s loopback and nowhere else'],
    ];
    for (const socket of ['/run/loki.sock', '~/loki.sock', '../loki.sock', 'sockets/../../loki.sock', 'sockets/', './loki.sock', '', `${'a'.repeat(96)}.sock`]) {
        cases.push([{label: 'a', from, to: {here: true, socket}}, `forwards[0].to.socket: a path inside serviceman's state dir, written from it, such as sockets/loki.sock — not from / or ~/, and never through .. — of at most 100 characters (got ${JSON.stringify(socket)})`]);
    }
    for (const [forward, message] of cases) {
        assert.throws(() => config_of([forward]), {message});
    }
    const twice = [
        {label: 'a', from, to: {here: true, socket: 'loki.sock'}},
        {label: 'b', from, to: {here: true, socket: 'loki.sock'}},
    ];
    assert.throws(() => config_of(twice), {message: 'forwards[1].to: "a" already listens there'});
    assert.deepStrictEqual(config_of([{label: 'a', from, to: {here: true, socket: 'sockets/loki.sock'}}]).forwards[0].to, {remote: null, here: true, port: null, socket: 'sockets/loki.sock', host: null});
    // The same place on a machine is another place
    assert.strictEqual(config_of([{label: 'a', from, to: {here: true, port: 1}}, {label: 'b', from, to: {remote: 'laptop', port: 1}}]).forwards.length, 2);
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

// `state_dir` is where a forward that shows up on serviceman itself puts its socket; the
// forwards it listens for open as they do at the start
async function serviceman_start(forwards, state_dir)
{
    const app = app_from_config(config_of(forwards));
    if (state_dir !== undefined) {
        app.state_dir = state_dir;
    }
    const servers = await server_start(app);
    await forwards_here(app);
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
            for (const name of Object.keys(app.forwards_here)) {
                if (app.forwards_here[name].server !== null) {
                    app.forwards_here[name].server.close();
                }
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
        const said = running.app.remote_by_name[running.app.config.forwards.find(v => v.label === name).to.remote].state.forwards_said;
        return (said !== null) && (said[name] !== undefined) && (said[name].error === null) && (running.app.remote_by_name.vps1.state.phase === 'online') && (running.app.remote_by_name.laptop.state.phase === 'online');
    });
}

async function wait_here(running, name)
{
    await wait_until(function () {
        const found = running.app.forwards_here[name];
        return (found !== undefined) && (found.error === null) && (running.app.remote_by_name.vps1.state.phase === 'online');
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
