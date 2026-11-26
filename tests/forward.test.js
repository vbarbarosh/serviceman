const app_apply_config = require('../src/main/src/helpers/app_apply_config');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const crypto = require('crypto');
const door_token = require('../src/main/src/helpers/door_token');
const doors_table = require('../src/main/src/helpers/doors_table');
const fetch_host = require('./fetch_host');
const forwards_here = require('../src/main/src/helpers/forwards_here');
const forwards_tell = require('../src/main/src/helpers/forwards_tell');
const fs = require('fs');
const http = require('http');
const link_read = require('../src/helpers/link_read');
const net = require('net');
const os = require('os');
const page_fetch_begin = require('./page_fetch_begin');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const stream = require('stream');
const test = require('node:test');
const timers = require('timers/promises');
const tunnel_inbound = require('../src/main/src/helpers/tunnel_inbound');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const TOKEN_LAPTOP = 'cccccccccccccccccccccccccccccccc';
const TOKEN_VPS = 'dddddddddddddddddddddddddddddddd';
const TOKEN_VPS2 = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

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

// A socket in a folder kept for sockets, ~/.sockets/, that is not there yet: the agent makes
// it the first time, for its user alone, as the program's card offers it
test('a forward\'s socket in a folder not made yet gets its folder, the agent\'s user\'s alone', async function () {
    const echo = await echo_server({port: 0, host: '127.0.0.1'});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-'));
    const sock = path.join(dir, 'not-made', '.sockets', 'llm.sock');
    const running = await serviceman_start([
        {label: 'llm → laptop', from: {remote: 'vps1', port: echo.address().port}, to: {remote: 'laptop', socket: sock}},
    ]);
    const agents = agents_start(running);
    try {
        await wait_listening(running, 'llm → laptop');
        assert.strictEqual(fs.statSync(path.dirname(sock)).mode & 0o777, 0o700);
        assert.strictEqual(fs.statSync(sock).mode & 0o777, 0o600);
        assert.strictEqual(await say_through({path: sock}, 'hello'), 'echo: hello');
    }
    finally {
        agents_stop(agents);
        await running.close();
        echo.close();
        fs.rmSync(dir, {recursive: true, force: true});
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

// An app on serviceman's own port, opened on the laptop by localhost: both ends are the
// laptop's, so its agent joins them itself. The bytes go there in one trip and never through
// serviceman, which may even be away; the page still counts them, from what the agent tells.
test('a forward with both ends on one machine is joined by its agent, not through serviceman', async function () {
    const echo = await echo_server({port: 0, host: '127.0.0.1'});
    const port = await port_free();
    const running = await serviceman_start([
        {label: 'notes on the laptop', from: {remote: 'laptop', host: '127.0.0.1', port: echo.address().port}, to: {remote: 'laptop', port}},
    ]);
    const agents = agents_start(running);
    try {
        await wait_listening(running, 'notes on the laptop');
        assert.strictEqual(await say_through({host: '127.0.0.1', port}, 'hello'), 'echo: hello');
        await wait_until(() => (counted(running, 'notes on the laptop').total === 1) && (counted(running, 'notes on the laptop').open === 0));
        const view = (await state_read(running)).forwards[0];
        assert.strictEqual(view.state, 'ready');
        assert.strictEqual(view.bytes_sent, 5);
        assert.strictEqual(view.bytes_back, 11);
        assert.strictEqual(Object.keys(running.app.remote_by_name.laptop.state.streams).length, 0, 'serviceman opened no stream for it');

        await running.close();
        assert.strictEqual(await say_through({host: '127.0.0.1', port}, 'serviceman is away'), 'echo: serviceman is away');
    }
    finally {
        agents_stop(agents);
        await running.close();
        echo.close();
    }
});

// The far end of a forward the agent joins itself refuses: the connection closes at once, and
// the page says why, as for one serviceman carries
test('a forward joined by its agent says why its far end refused', async function () {
    const gone = await port_free();
    const port = await port_free();
    const running = await serviceman_start([
        {label: 'nothing there', from: {remote: 'laptop', port: gone}, to: {remote: 'laptop', port}},
    ]);
    const agents = agents_start(running);
    try {
        await wait_listening(running, 'nothing there');
        assert.strictEqual(await say_through({host: '127.0.0.1', port}, 'hello'), '');
        await wait_until(() => /^laptop: .*ECONNREFUSED/.test(counted(running, 'nothing there').error));
        assert.strictEqual(running.app.log_lines.some(v => /\[forward_error\] forward="nothing there" reason="laptop: .*ECONNREFUSED/.test(v)), true);
    }
    finally {
        agents_stop(agents);
        await running.close();
    }
});

// What a machine is told: the far end only of its own forwards whose two ends are its, and only
// when its agent says it can dial; an older agent hears what it heard before
test('a machine is told the far end of a forward only when both ends are its own and it can dial', function () {
    const app = app_from_config(config_of([
        {label: 'here', from: {remote: 'laptop', host: '100.64.0.20', port: 3400}, to: {remote: 'laptop', port: 5460}},
        {label: 'a socket here', from: {remote: 'laptop', socket: '~/app.sock'}, to: {remote: 'laptop', port: 5461}},
        {label: 'from vps1', from: {remote: 'vps1', port: 3100}, to: {remote: 'laptop', socket: '~/loki.sock'}},
    ]));
    const laptop = app.remote_by_name.laptop;
    laptop.state.resources = {can: ['forwards', 'forwards_dial']};
    assert.deepStrictEqual(forwards_tell.forwards_of(app, laptop), [
        {name: 'here', port: 5460, dial: {host: '100.64.0.20', port: 3400}},
        {name: 'a socket here', port: 5461, dial: {path: '~/app.sock'}},
        {name: 'from vps1', socket: '~/loki.sock'},
    ]);
    laptop.state.resources = {can: ['forwards']};
    assert.deepStrictEqual(forwards_tell.forwards_of(app, laptop), [
        {name: 'here', port: 5460},
        {name: 'a socket here', port: 5461},
        {name: 'from vps1', socket: '~/loki.sock'},
    ]);
    // Another machine's: where its agent listens and its token, once both agents speak to their
    // peers and it said where it listens
    const vps1 = app.remote_by_name.vps1;
    laptop.state.resources = {can: ['forwards', 'forwards_dial', 'peer_streams']};
    vps1.state.resources = {can: ['forwards', 'peer_streams']};
    vps1.state.doors_peer = {addresses: ['100.64.0.20'], port: 7303};
    const peer = {addresses: ['100.64.0.20'], port: 7303, token: door_token(app, 'vps1')};
    assert.deepStrictEqual(forwards_tell.forwards_of(app, laptop)[2], {name: 'from vps1', socket: '~/loki.sock', peer});
    vps1.state.resources = {can: ['forwards']};
    assert.deepStrictEqual(forwards_tell.forwards_of(app, laptop)[2], {name: 'from vps1', socket: '~/loki.sock'}, 'an older agent on vps1');
    vps1.state.resources = {can: ['forwards', 'peer_streams']};
    laptop.state.resources = {can: ['forwards', 'forwards_dial']};
    assert.deepStrictEqual(forwards_tell.forwards_of(app, laptop)[2], {name: 'from vps1', socket: '~/loki.sock'}, 'an older agent on the laptop');
});

// A database server's public port is told to its machine's agent only when that agent can listen
// beyond its loopback: an older one would open it there, so it hears nothing of it. With TLS, its
// certificate goes with it, made for the machine's addresses; one that cannot be made yet (no
// address known) is never told plain instead.
test('a public port is told with where it listens, who it lets in and its certificate', function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-public-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const app = app_from_config(config_of([
        {label: 'mongodb-1 → the internet', database: 'mongodb-1', from: {remote: 'laptop', port: 41337}, to: {remote: 'laptop', port: 27017, host: '0.0.0.0'}, tls: true, allow: ['198.51.100.7']},
        {label: 'plain', database: 'mongodb-2', from: {remote: 'laptop', port: 41338}, to: {remote: 'laptop', port: 27018, host: '0.0.0.0'}},
    ]));
    app.state_dir = dir;
    fs.writeFileSync(path.join(dir, 'databases.json'), JSON.stringify({servers: [{name: 'mongodb-1', engine: 'mongodb', remote: 'laptop', users: {}}, {name: 'mongodb-2', engine: 'mongodb', remote: 'laptop', users: {}}]}));
    const laptop = app.remote_by_name.laptop;
    laptop.state.resources = {can: ['forwards', 'forwards_dial'], addresses: ['203.0.113.5']};
    assert.deepStrictEqual(forwards_tell.forwards_of(app, laptop), [], 'an agent from before public ports');
    laptop.state.resources = {can: ['forwards', 'forwards_dial', 'forwards_public'], addresses: []};
    assert.deepStrictEqual(forwards_tell.forwards_of(app, laptop), [{name: 'plain', port: 27018, dial: {port: 41338}, host: '0.0.0.0'}], 'TLS with no address to name is not told at all');
    laptop.state.resources = {can: ['forwards', 'forwards_dial', 'forwards_public'], addresses: ['203.0.113.5']};
    const told = forwards_tell.forwards_of(app, laptop);
    assert.deepStrictEqual(told.map(v => Object.keys(v).join(' ')), ['name port dial host allow tls', 'name port dial host']);
    assert.deepStrictEqual([told[0].host, told[0].allow, Object.keys(told[0].tls)], ['0.0.0.0', ['198.51.100.7'], ['cert', 'key']]);
    assert.strictEqual(new crypto.X509Certificate(told[0].tls.cert).subjectAltName, 'IP Address:203.0.113.5');
    assert.deepStrictEqual(forwards_tell.forwards_of(app, laptop)[0].tls, told[0].tls, 'made once, and kept');
});

// The author's case, straight: a port on vps1 shows up on the laptop, and each connection goes
// from the laptop's agent to vps1's on its peer port, never through serviceman, which may even
// be away; the page counts it from what the laptop's agent tells
test('a forward between two machines goes straight between their agents, not through serviceman', async function () {
    const echo = await echo_server({port: 0, host: '127.0.0.1'});
    const port = await port_free();
    const running = await serviceman_start([
        {label: 'loki', from: {remote: 'vps1', port: echo.address().port}, to: {remote: 'laptop', port}},
    ]);
    const agents = await agents_start_peers(running);
    try {
        await wait_straight(running, 'loki');
        assert.deepStrictEqual(Object.keys(doors_table(running.app, running.app.remote_by_name.vps1).streams.forwards), ['loki']);
        assert.strictEqual(doors_table(running.app, running.app.remote_by_name.laptop).streams, undefined, 'nothing is opened on the laptop for it');

        assert.strictEqual(await say_through({host: '127.0.0.1', port}, 'hello'), 'echo: hello');
        assert.strictEqual(await say_through({host: '127.0.0.1', port}, 'x'.repeat(600000)), `echo: ${'x'.repeat(600000)}`, 'more than a window each way');
        await wait_until(() => (counted(running, 'loki').total === 2) && (counted(running, 'loki').open === 0));
        const view = (await state_read(running)).forwards[0];
        assert.strictEqual(view.state, 'ready');
        assert.strictEqual(view.way, 'straight');
        assert.strictEqual(view.way_why, null);
        assert.strictEqual(view.bytes_sent, 5 + 600000);
        assert.strictEqual(view.bytes_back, 11 + 600006);

        // Open while it is asked: no stream of serviceman's carries it
        const open = net.connect({host: '127.0.0.1', port});
        await new Promise(v => open.once('connect', v));
        open.write('held');
        await wait_until(() => counted(running, 'loki').open === 1);
        assert.strictEqual(Object.keys(running.app.remote_by_name.laptop.state.streams).length, 0, 'serviceman opened no stream for it on the laptop');
        assert.strictEqual(Object.keys(running.app.remote_by_name.vps1.state.streams).length, 0, 'nor on vps1');
        open.destroy();

        await running.close();
        assert.strictEqual(await say_through({host: '127.0.0.1', port}, 'serviceman is away'), 'echo: serviceman is away');
    }
    finally {
        agents_stop(agents);
        await running.close();
        echo.close();
    }
});

// The service over there refuses: the connection closes at once, and the page says why, in the
// words of the machine the service is on, as for one serviceman carries
test('a forward between two machines says why the service over there refused', async function () {
    const gone = await port_free();
    const port = await port_free();
    const running = await serviceman_start([
        {label: 'nothing there', from: {remote: 'vps1', port: gone}, to: {remote: 'laptop', port}},
    ]);
    const agents = await agents_start_peers(running);
    try {
        await wait_straight(running, 'nothing there');
        assert.strictEqual(await say_through({host: '127.0.0.1', port}, 'hello'), '');
        await wait_until(() => /^vps1: .*ECONNREFUSED/.test(counted(running, 'nothing there').error));
        assert.strictEqual(Object.keys(running.app.remote_by_name.laptop.state.streams).length, 0, 'not tried again through serviceman');
    }
    finally {
        agents_stop(agents);
        await running.close();
    }
});

// vps1's agent was told it listens for its peers where nothing answers now — its peer port
// off, or the laptop off the tailnet: each connection goes through serviceman as before, and
// the page says why it is not straight
test('a forward whose peer does not answer goes through serviceman, and the page says why', async function () {
    const echo = await echo_server({port: 0, host: '127.0.0.1'});
    const port = await port_free();
    const nobody = await port_free();
    const running = await serviceman_start([
        {label: 'loki', from: {remote: 'vps1', port: echo.address().port}, to: {remote: 'laptop', port}},
    ]);
    const agents = await agents_start_peers(running);
    try {
        await wait_straight(running, 'loki');
        running.app.remote_by_name.vps1.state.doors_peer = {addresses: ['127.0.0.1'], port: nobody};
        running.app.remote_by_name.laptop.state.forwards_told = null;
        await forwards_tell(running.app);
        await wait_until(() => running.app.remote_by_name.laptop.state.forwards_told.includes(`"port":${nobody}`));

        assert.strictEqual(await say_through({host: '127.0.0.1', port}, 'hello'), 'echo: hello');
        await wait_until(() => (counted(running, 'loki').total === 1) && (counted(running, 'loki').peer_away !== null));
        const view = (await state_read(running)).forwards[0];
        assert.strictEqual(view.way, 'serviceman');
        assert.match(view.way_why, /ECONNREFUSED/);
    }
    finally {
        agents_stop(agents);
        await running.close();
        echo.close();
    }
});

// A peer's port is reached by every device of the tailnet: only a caller with the token gets a
// stream, and only of a forward serviceman wrote into that machine's table
test('the peer port opens a stream only with the token, and only one serviceman wrote', async function () {
    const echo = await echo_server({port: 0, host: '127.0.0.1'});
    const port = await port_free();
    const running = await serviceman_start([
        {label: 'loki', from: {remote: 'vps1', port: echo.address().port}, to: {remote: 'laptop', port}},
    ]);
    const agents = await agents_start_peers(running);
    try {
        await wait_straight(running, 'loki');
        const peer = running.app.remote_by_name.vps1.state.doors_peer;
        const token = doors_table(running.app, running.app.remote_by_name.vps1).token;
        assert.strictEqual((await stream_ask(peer, '/forward/loki', 'not the token')).status, 403);
        assert.strictEqual((await stream_ask(peer, '/forward/loki', 'null')).status, 403);
        assert.strictEqual((await stream_ask(peer, '/forward/loki', '')).status, 403);
        assert.strictEqual((await stream_ask(peer, '/forward/ssh', token)).status, 404);
        assert.strictEqual((await stream_ask(peer, '/forward/loki/../ssh', token)).status, 400);
        assert.strictEqual((await stream_ask(peer, '/mount/loki', token)).status, 404, 'a forward is no mount');
        assert.strictEqual((await stream_ask(peer, '/forward/loki', token)).status, 101);
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

// "forget it" on the forward whose form is open emptied the form before the door was asked: one
// the door did not forget lost what was typed there, and what the door said had no form left to
// be shown in. The section is driven here as vue drives it, its data and its methods on one object.
test('the form open on a forward stays as it was typed when the door does not forget the forward', async function () {
    const forwards_section = (await import(path.join(__dirname, '..', 'src', 'main', 'public', 'forwards_section.js'))).default;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-forget-'));
    const config_path = path.join(dir, 'serviceman.json');
    const forwards = [{label: 'loki', from: {remote: 'vps1', port: 3100}, to: {remote: 'laptop', socket: '~/repos/loki.sock'}}];
    fs.writeFileSync(config_path, JSON.stringify({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: remotes_json(), forwards, services: []}));
    const config = config_from_json(JSON.parse(fs.readFileSync(config_path, 'utf8')), dir);
    config.path = config_path;
    const servers = await server_start(app_from_config(config));
    // A door that is away: the port of a server that has closed
    const away = net.createServer().listen(0, '127.0.0.1');
    await new Promise(v => away.once('listening', v));
    const away_port = away.address().port;
    await new Promise(v => away.close(v));
    const typed = {label: 'loki, typed again', from_remote: 'vps1', from: '3999', to_remote: 'laptop', to: '~/repos/loki.sock'};
    const form = Object.assign(forwards_section.data(), forwards_section.methods, {making: true, editing: forwards[0], fresh: typed});
    let page_fetch_end = page_fetch_begin(away_port);
    try {
        await form.drop(forwards[0]);
        assert.deepStrictEqual({making: form.making, editing: form.editing, fresh: form.fresh, note: form.note, bad: form.bad, busy: form.busy}, {making: true, editing: forwards[0], fresh: typed, note: 'the answer never came back', bad: true, busy: false});
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(config_path, 'utf8')).forwards, forwards, 'and the forward is still there');

        // The door back, the forward is forgotten and its form goes with it
        page_fetch_end();
        page_fetch_end = page_fetch_begin(servers.control.address().port);
        await form.drop(forwards[0]);
        assert.deepStrictEqual({making: form.making, editing: form.editing, note: form.note, bad: form.bad, busy: form.busy}, {making: false, editing: null, note: '', bad: false, busy: false});
        assert.strictEqual(JSON.parse(fs.readFileSync(config_path, 'utf8')).forwards, undefined);
    }
    finally {
        page_fetch_end();
        servers.control.close();
        servers.server.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// Visual Agency's case: its token carries sockets between the machines it sees, and reads and
// writes those forwards alone; the owner's, and any of another machine, stay as they were
test('a token with the forwards right reads and writes the forwards between its machines alone', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-token-'));
    const config_path = path.join(dir, 'serviceman.json');
    const before = [
        {label: 'loki', from: {remote: 'vps1', port: 3100}, to: {remote: 'laptop', socket: '~/repos/loki.sock'}},
        {label: 'db on vps2', from: {remote: 'vps2', port: 5432}, to: {remote: 'laptop', port: 5432}},
        {label: 'logline here', from: {remote: 'vps1', port: 8123}, to: {here: true, socket: 'sockets/logline.sock'}, off: true},
        {label: 'a lan box', from: {remote: 'vps1', host: '10.0.0.5', port: 80}, to: {remote: 'laptop', port: 8080}},
        {label: 'grafana', from: {remote: 'laptop', port: 3000}, to: {remote: 'vps1', port: 3000}, off: true},
    ];
    fs.writeFileSync(config_path, JSON.stringify({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: remotes_json().concat([{name: 'vps2', token: TOKEN_VPS2}]), forwards: before, services: []}));
    const config = config_from_json(JSON.parse(fs.readFileSync(config_path, 'utf8')), dir);
    config.path = config_path;
    const app = app_from_config(config);
    app.state_dir = dir;
    const servers = await server_start(app);
    const port = servers.control.address().port;
    function call(method, body, token) {
        return fetch_host({port, host: '127.0.0.1', path: '/api/v1/forwards', method, token, body: (body === undefined) ? undefined : JSON.stringify({forwards: body})});
    }
    function file_forwards() {
        return JSON.parse(fs.readFileSync(config_path, 'utf8')).forwards;
    }
    try {
        const made = await fetch_host({port, host: '127.0.0.1', path: '/api/v1/tokens', method: 'POST', body: JSON.stringify({label: 'visual-agency', remotes: ['vps1', 'laptop'], rights: ['forwards']})});
        assert.strictEqual(made.status, 200, made.body);
        const token = JSON.parse(made.body).token;
        const by = {token: JSON.parse(made.body).item.id, label: 'visual-agency'};

        // The owner's sees them all; the token those between its machines, as the file writes them
        assert.deepStrictEqual(JSON.parse((await call('GET')).body).forwards, before);
        assert.deepStrictEqual(JSON.parse((await call('GET', undefined, token)).body).forwards, [before[0], before[4]]);
        const config_read = await fetch_host({port, host: '127.0.0.1', path: '/api/v1/config', token});
        assert.deepStrictEqual([config_read.status, JSON.parse(config_read.body).error], [403, 'the token "visual-agency" has no right to this'], 'the rest of the config is the owner\'s');

        // Its list takes the place of its forwards; the others stay, where they were. What it
        // added says it asked for it; the owner's it sent back as it was stays the owner's
        const own = {label: 'Visual Agency: notes/loki.sock on vps1', from: {remote: 'laptop', socket: '~/repos/loki.sock'}, to: {remote: 'vps1', socket: '~/visual-agency/notes/loki.sock'}};
        const own_by = Object.assign({}, own, {by});
        const written = await call('PUT', [before[4], own], token);
        assert.strictEqual(written.status, 200, written.body);
        assert.deepStrictEqual(file_forwards(), [before[4], own_by, before[1], before[2], before[3]]);
        assert.deepStrictEqual(app.config.forwards.map(v => v.label), ['grafana', 'Visual Agency: notes/loki.sock on vps1', 'db on vps2', 'logline here', 'a lan box']);
        assert.deepStrictEqual(JSON.parse((await call('GET', undefined, token)).body).forwards, [before[4], own_by]);
        assert.deepStrictEqual(app.config.forwards[1].by, by);

        // A `by` it sends is never taken: sent back as they were, both stay whose they were
        const forged = {token: 'ffffffffffffffff', label: 'the owner'};
        assert.strictEqual((await call('PUT', [Object.assign({}, before[4], {by: forged}), Object.assign({}, own_by, {by: forged})], token)).status, 200);
        assert.deepStrictEqual(file_forwards(), [before[4], own_by, before[1], before[2], before[3]]);
        // A forward of the owner's it changes is one it asked for from then on
        const turned = Object.assign({}, before[4], {off: false});
        assert.strictEqual((await call('PUT', [turned, own_by], token)).status, 200);
        assert.deepStrictEqual(file_forwards()[0], Object.assign({}, turned, {by}));
        assert.strictEqual((await call('PUT', [before[4], own_by], token)).status, 200);

        // A forward past its machines is refused, said with the forward that named it, and the
        // file stays as it was
        const refused = [
            [[own, {label: 'x', from: {remote: 'vps2', port: 1}, to: {remote: 'vps1', port: 2}}], 'forwards[1]: the token "visual-agency" may not see vps2'],
            [[{label: 'x', from: {remote: 'vps1', port: 1}, to: {remote: 'vps2', port: 2}}], 'forwards[0]: the token "visual-agency" may not see vps2'],
            [[{label: 'x', from: {remote: 'vps1', port: 1}, to: {here: true, port: 2}}], 'forwards[0]: the token "visual-agency" may not open a forward on serviceman itself'],
            [[{label: 'x', from: {remote: 'vps1', host: '10.0.0.5', port: 1}, to: {remote: 'laptop', port: 2}}], 'forwards[0]: the token "visual-agency" may not reach an address beyond its machines'],
        ];
        for (const [list, error] of refused) {
            const answer = await call('PUT', list, token);
            assert.deepStrictEqual([answer.status, JSON.parse(answer.body).error], [403, error]);
        }
        const twice = await call('PUT', [{label: 'db on vps2', from: {remote: 'vps1', port: 1}, to: {remote: 'laptop', port: 2}}], token);
        assert.strictEqual(twice.status, 400);
        assert.match(JSON.parse(twice.body).error, /"db on vps2" is used twice$/);
        assert.deepStrictEqual(file_forwards(), [Object.assign({}, before[4], {by}), own_by, before[1], before[2], before[3]]);
        assert.strictEqual(app.log_lines.some(v => /\[control_token_refused\] .*token=visual-agency method=PUT path=\/api\/v1\/forwards reason="may not see vps2"/.test(v)), true);

        // An empty list takes its forwards away, and only them
        assert.strictEqual((await call('PUT', [], token)).status, 200);
        assert.deepStrictEqual(file_forwards(), [before[1], before[2], before[3]]);

        // Every machine is every machine; serviceman itself and an address beyond are still the owner's
        const every = JSON.parse((await fetch_host({port, host: '127.0.0.1', path: '/api/v1/tokens', method: 'POST', body: JSON.stringify({label: 'every machine', remotes: ['*'], rights: ['forwards']})})).body).token;
        assert.deepStrictEqual(JSON.parse((await call('GET', undefined, every)).body).forwards, [before[1]]);

        // Without the right neither is let in
        const reader = JSON.parse((await fetch_host({port, host: '127.0.0.1', path: '/api/v1/tokens', method: 'POST', body: JSON.stringify({label: 'a reader', remotes: ['vps1'], rights: ['status']})})).body).token;
        const read = await call('GET', undefined, reader);
        assert.deepStrictEqual([read.status, JSON.parse(read.body).error], [403, 'the token "a reader" may not read the forwards']);
        const write = await call('PUT', [], reader);
        assert.deepStrictEqual([write.status, JSON.parse(write.body).error], [403, 'the token "a reader" may not write the forwards']);
        assert.deepStrictEqual(file_forwards(), [before[1], before[2], before[3]]);
    }
    finally {
        servers.control.close();
        servers.server.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// The author's rule: a forward says which token asked for it, and when that token goes, or may
// no longer hold it, the forward is set aside at once, still saying whose it was
test('a token\'s forwards are set aside when it is revoked or may no longer hold them, and say whose they were', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-revoke-'));
    const config_path = path.join(dir, 'serviceman.json');
    const owners = {label: 'loki', from: {remote: 'vps1', port: 3100}, to: {remote: 'laptop', socket: '~/repos/loki.sock'}};
    fs.writeFileSync(config_path, JSON.stringify({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: remotes_json().concat([{name: 'vps2', token: TOKEN_VPS2}]), forwards: [owners], services: []}));
    const config = config_from_json(JSON.parse(fs.readFileSync(config_path, 'utf8')), dir);
    config.path = config_path;
    const app = app_from_config(config);
    app.state_dir = dir;
    const servers = await server_start(app);
    const port = servers.control.address().port;
    function call(method, asked, body, token) {
        return fetch_host({port, host: '127.0.0.1', path: asked, method, token, body: (body === undefined) ? undefined : JSON.stringify(body)});
    }
    async function token_make(label, remotes, rights) {
        const made = await call('POST', '/api/v1/tokens', {label, remotes, rights});
        assert.strictEqual(made.status, 200, made.body);
        return JSON.parse(made.body);
    }
    function file_forwards() {
        return JSON.parse(fs.readFileSync(config_path, 'utf8')).forwards;
    }
    try {
        const va = await token_make('visual-agency', ['vps1', 'vps2', 'laptop'], ['forwards']);
        const va_by = {token: va.item.id, label: 'visual-agency'};
        const near = {label: 'Visual Agency: notes/a.sock on vps1', from: {remote: 'laptop', socket: '~/a.sock'}, to: {remote: 'vps1', socket: '~/va/a.sock'}};
        const far = {label: 'Visual Agency: notes/b.sock on laptop', from: {remote: 'vps2', port: 9000}, to: {remote: 'laptop', socket: '~/va/b.sock'}};
        const resting = {label: 'Visual Agency: notes/c.sock on laptop', from: {remote: 'vps2', port: 9001}, to: {remote: 'laptop', socket: '~/va/c.sock'}, off: true};
        assert.strictEqual((await call('PUT', '/api/v1/forwards', {forwards: [owners, near, far, resting]}, va.token)).status, 200);
        assert.deepStrictEqual(file_forwards(), [owners, Object.assign({}, near, {by: va_by}), Object.assign({}, far, {by: va_by}), Object.assign({}, resting, {by: va_by})]);

        // The page says who asked
        const shown = JSON.parse((await call('GET', '/api/v1/status')).body).forwards;
        assert.deepStrictEqual(shown.map(v => v.by), [null, {label: 'visual-agency', revoked: false}, {label: 'visual-agency', revoked: false}, {label: 'visual-agency', revoked: false}]);

        // A machine taken from it sets aside what it asked for there, and nothing else; one set
        // aside already is left as it is
        const narrowed = await call('PUT', `/api/v1/tokens/${va.item.id}`, {label: 'visual-agency', remotes: ['vps1', 'laptop'], rights: ['forwards']});
        assert.deepStrictEqual(JSON.parse(narrowed.body).forwards_set_aside, ['Visual Agency: notes/b.sock on laptop']);
        assert.deepStrictEqual(file_forwards().map(v => v.off === true), [false, false, true, true]);
        assert.strictEqual(app.config.forwards[2].off, true, 'and the machines are told');
        assert.strictEqual(app.log_lines.some(v => /\[forward_set_aside\] forward="Visual Agency: notes\/b.sock on laptop" token=visual-agency reason="its token may not see vps2"/.test(v)), true);

        // A new value is the same token: nothing is set aside
        assert.deepStrictEqual(JSON.parse((await call('POST', `/api/v1/tokens/${va.item.id}/rotate`)).body).forwards_set_aside, []);

        // Revoked, the rest goes aside, and still says whose it was
        assert.deepStrictEqual(JSON.parse((await call('DELETE', `/api/v1/tokens/${va.item.id}`)).body).forwards_set_aside, ['Visual Agency: notes/a.sock on vps1']);
        assert.deepStrictEqual(file_forwards(), [owners, Object.assign({}, near, {by: va_by, off: true}), Object.assign({}, far, {by: va_by, off: true}), Object.assign({}, resting, {by: va_by})]);
        assert.strictEqual(app.log_lines.some(v => /\[forward_set_aside\] forward="Visual Agency: notes\/a.sock on vps1" token=visual-agency reason="its token was revoked"/.test(v)), true);
        const after = JSON.parse((await call('GET', '/api/v1/status')).body).forwards;
        assert.deepStrictEqual(after.map(v => [v.by, v.state]), [[null, after[0].state], [{label: 'visual-agency', revoked: true}, 'aside'], [{label: 'visual-agency', revoked: true}, 'aside'], [{label: 'visual-agency', revoked: true}, 'aside']]);

        // The right taken away sets aside all it asked for
        const other = await token_make('another app', ['vps1', 'laptop'], ['forwards']);
        const its = {label: 'another app: d.sock', from: {remote: 'vps1', port: 3200}, to: {remote: 'laptop', socket: '~/d.sock'}};
        assert.strictEqual((await call('PUT', '/api/v1/forwards', {forwards: [owners, its]}, other.token)).status, 200);
        const reader = await call('PUT', `/api/v1/tokens/${other.item.id}`, {label: 'another app', remotes: ['vps1', 'laptop'], rights: ['status']});
        assert.deepStrictEqual(JSON.parse(reader.body).forwards_set_aside, ['another app: d.sock']);
        assert.strictEqual(app.log_lines.some(v => /\[forward_set_aside\] forward="another app: d.sock" token="another app" reason="its token may no longer write the forwards"/.test(v)), true);
        assert.deepStrictEqual(file_forwards()[0], owners, 'the owner\'s is never touched');
    }
    finally {
        servers.control.close();
        servers.server.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// Visual Agency carries a socket of serviceman's own on to a machine: it reads where the socket
// comes from, and copies that `from` into a forward of its own; the sources are read, never
// written
test('a token reads the sources of serviceman\'s own sockets on its machines, and writes none of them', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-sources-'));
    const config_path = path.join(dir, 'serviceman.json');
    const before = [
        {label: 'loki', from: {remote: 'vps1', port: 3100}, to: {here: true, socket: 'sockets/loki.sock'}},
        {label: 'metrics on vps2', from: {remote: 'vps2', port: 9000}, to: {here: true, socket: 'sockets/metrics.sock'}},
        {label: 'a lan box', from: {remote: 'vps1', host: '10.0.0.5', port: 80}, to: {here: true, socket: 'sockets/lan.sock'}},
        {label: 'set aside', from: {remote: 'vps1', port: 8123}, to: {here: true, socket: 'sockets/aside.sock'}, off: true},
        {label: 'docker', from: {remote: 'vps1', socket: '/run/docker.sock'}, to: {here: true, port: await port_free_found()}},
    ];
    fs.writeFileSync(config_path, JSON.stringify({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: remotes_json().concat([{name: 'vps2', token: TOKEN_VPS2}]), forwards: before, services: []}));
    const config = config_from_json(JSON.parse(fs.readFileSync(config_path, 'utf8')), dir);
    config.path = config_path;
    const app = app_from_config(config);
    app.state_dir = dir;
    const servers = await server_start(app);
    const port = servers.control.address().port;
    async function token_make(remotes) {
        const made = await fetch_host({port, host: '127.0.0.1', path: '/api/v1/tokens', method: 'POST', body: JSON.stringify({label: 'visual-agency', remotes, rights: ['forwards']})});
        assert.strictEqual(made.status, 200, made.body);
        return JSON.parse(made.body);
    }
    async function read(token) {
        const answer = await fetch_host({port, host: '127.0.0.1', path: '/api/v1/forwards', token});
        assert.strictEqual(answer.status, 200, answer.body);
        return JSON.parse(answer.body);
    }
    function write(body, token) {
        return fetch_host({port, host: '127.0.0.1', path: '/api/v1/forwards', method: 'PUT', token, body: JSON.stringify(body)});
    }
    try {
        const made = await token_make(['vps1', 'laptop']);
        const token = made.token;
        const loki = {socket: 'sockets/loki.sock', from: before[0].from};
        const lan = {socket: 'sockets/lan.sock', from: before[2].from};
        const docker = {port: before[4].to.port, from: before[4].from};

        // A source counts when its `from` is on a machine the token sees; one set aside does not
        assert.deepStrictEqual(await read(token), {forwards: [], sources: [loki, lan, docker]});
        assert.deepStrictEqual((await read()).sources, [loki, {socket: 'sockets/metrics.sock', from: before[1].from}, lan, docker], 'the owner\'s sees every one');
        assert.deepStrictEqual((await read((await token_make(['laptop'])).token)).sources, [], 'without vps1 its sources are not seen');

        // Its own forward copies a `from`; the sources stay as they were, whatever it sends of them
        const own = {label: 'Visual Agency: notes/loki.sock on laptop', from: loki.from, to: {remote: 'laptop', socket: '~/visual-agency/environments/notes/sockets/loki.sock'}};
        const own_by = Object.assign({}, own, {by: {token: made.item.id, label: 'visual-agency'}});
        const written = await write({forwards: [own], sources: []}, token);
        assert.strictEqual(written.status, 200, written.body);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(config_path, 'utf8')).forwards, before.concat([own_by]));
        assert.deepStrictEqual(await read(token), {forwards: [own_by], sources: [loki, lan, docker]});

        // An address beyond the machine is listed, and a token may not carry it
        const beyond = await write({forwards: [own_by, {label: 'Visual Agency: notes/lan.sock on laptop', from: lan.from, to: {remote: 'laptop', socket: '~/lan.sock'}}]}, token);
        assert.deepStrictEqual([beyond.status, JSON.parse(beyond.body).error], [403, 'forwards[1]: the token "visual-agency" may not reach an address beyond its machines']);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(config_path, 'utf8')).forwards, before.concat([own_by]));
    }
    finally {
        app.config.forwards = [];
        await forwards_here(app);
        servers.control.close();
        servers.server.close();
        fs.rmSync(dir, {recursive: true, force: true});
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
        [{label: 'a', from: {remote: 'laptop', port: 5460}, to: {remote: 'laptop', port: 5460}}, 'forwards[0].from: where the forward listens itself, on laptop; each connection would reach itself'],
        [{label: 'a', from: {remote: 'laptop', host: '127.0.0.1', port: 5460}, to: {remote: 'laptop', port: 5460}}, 'forwards[0].from: where the forward listens itself, on laptop; each connection would reach itself'],
        [{label: 'a', from: {remote: 'laptop', socket: '~/a.sock'}, to: {remote: 'laptop', socket: '~/a.sock'}}, 'forwards[0].from: where the forward listens itself, on laptop; each connection would reach itself'],
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
    // Both ends on one machine, to anything but where it listens, is a forward its agent joins
    assert.strictEqual(config_of([{label: 'a', from: {remote: 'laptop', host: '100.64.0.20', port: 5460}, to: {remote: 'laptop', port: 5460}}]).forwards.length, 1);
    assert.strictEqual(config_of([{label: 'a', from: {remote: 'laptop', port: 3400}, to: {remote: 'laptop', port: 5460}}]).forwards.length, 1);
    // No forwards is an empty list, and an end keeps every field, null where it was not written
    assert.deepStrictEqual(config_of([]).forwards, []);
    assert.deepStrictEqual(config_of([{label: 'a', from: {remote: 'vps1', host: '10.0.0.5', port: 2}, to: {remote: 'laptop', socket: '~/a.sock'}}]).forwards, [
        {label: 'a', from: {remote: 'vps1', here: false, port: 2, socket: null, host: '10.0.0.5'}, to: {remote: 'laptop', here: false, port: null, socket: '~/a.sock', host: null}, off: false, by: null, service: null, database: null, tls: false, allow: []},
    ]);
    // A database server's port brought over is part of that server, named as the Databases page
    // names one; never part of a service as well
    assert.strictEqual(config_of([{label: 'a', database: 'mongodb-1', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 1}}]).forwards[0].database, 'mongodb-1');
    for (const wrong of [null, '', 'Mongo DB', '1-mongo', 'x'.repeat(41)]) {
        assert.throws(() => config_of([{label: 'a', database: wrong, from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 1}}]), {message: `forwards[0].database: the name of the database server it is part of, or left out (got ${JSON.stringify(wrong)})`});
    }
    assert.throws(() => config_of([{label: 'a', service: 'llm', database: 'mongodb-1', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 1}}]), {message: 'forwards[0].database: a forward is part of a service or of a database server, not both'});
    // Every address of its machine, a database server's public port alone: on its own machine, a
    // port, TLS and who may connect beside it and on no other forward
    const opened = config_of([{label: 'a', database: 'mongodb-1', from: {remote: 'vps1', port: 2}, to: {remote: 'vps1', port: 27017, host: '0.0.0.0'}, tls: true, allow: ['198.51.100.7', '10.0.0.0/8', '2001:db8::/32']}]).forwards[0];
    assert.deepStrictEqual([opened.to.host, opened.tls, opened.allow], ['0.0.0.0', true, ['198.51.100.7', '10.0.0.0/8', '2001:db8::/32']]);
    for (const [wrong, message] of [
        [{to: {remote: 'laptop', port: 1, host: '0.0.0.0'}}, 'forwards[0].to.host: a forward shows up on its machine\'s loopback and nowhere else'],
        [{database: 'mongodb-1', to: {remote: 'laptop', port: 1, host: '0.0.0.0'}}, 'forwards[0].to: a public port is a port on its server\'s own machine, vps1'],
        [{database: 'mongodb-1', to: {remote: 'vps1', port: 1, host: '203.0.113.5'}}, 'forwards[0].to.host: 0.0.0.0, every address of its machine, or left out for its loopback (got "203.0.113.5")'],
        [{database: 'mongodb-1', to: {remote: 'vps1', port: 1}, tls: true}, 'forwards[0].tls: TLS is a public port\'s, one whose "to" has "host": "0.0.0.0"'],
        [{database: 'mongodb-1', to: {remote: 'vps1', port: 1}, allow: ['198.51.100.7']}, 'forwards[0].allow: who may connect is a public port\'s, one whose "to" has "host": "0.0.0.0"'],
        [{database: 'mongodb-1', to: {remote: 'vps1', port: 1, host: '0.0.0.0'}, tls: 'yes'}, 'forwards[0].tls: true or false (got "yes")'],
        [{database: 'mongodb-1', to: {remote: 'vps1', port: 1, host: '0.0.0.0'}, allow: ['10.0.0.0/33']}, 'forwards[0].allow: an address or a network, such as 203.0.113.5 or 10.0.0.0/8 (got "10.0.0.0/33")'],
    ]) {
        assert.throws(() => config_of([Object.assign({label: 'a', from: {remote: 'vps1', port: 2}}, wrong)]), {message}, JSON.stringify(wrong));
    }
    // The token that asked for it is serviceman's to write, and read back as it was
    const by = {token: '4c6b2ea73dc33d08', label: 'visual-agency'};
    assert.deepStrictEqual(config_of([{label: 'a', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 1}, by}]).forwards[0].by, by);
    for (const wrong of [null, 'visual-agency', {token: 'not hex', label: 'x'}, {token: 'abc'}, {token: 'abc', label: 'two\nlines'}]) {
        assert.throws(() => config_of([{label: 'a', from: {remote: 'vps1', port: 2}, to: {remote: 'laptop', port: 1}, by: wrong}]), {message: `forwards[0].by: {"token": "<a token's id>", "label": "<its label>"}, written by serviceman for a forward a token asked for (got ${JSON.stringify(wrong)})`});
    }
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
        assert.deepStrictEqual(Object.keys(running.app.forwards_here), []);
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

// The two machines, each agent listening for its peers on 127.0.0.1 at a port of its own, as
// on the tailnet each listens at its own address
async function agents_start_peers(running)
{
    const ports = [await port_free(), await port_free()];
    return {
        laptop: agent_start(running.control_port, TOKEN_LAPTOP, {SERVICEMAN_PEER_HOST: '127.0.0.1', SERVICEMAN_PEER_PORT: String(ports[0])}),
        vps1: agent_start(running.control_port, TOKEN_VPS, {SERVICEMAN_PEER_HOST: '127.0.0.1', SERVICEMAN_PEER_PORT: String(ports[1])}),
    };
}

// Until the laptop was told where vps1's agent listens, and vps1 was told what it may open for it
async function wait_straight(running, label)
{
    await wait_listening(running, label);
    const laptop = running.app.remote_by_name.laptop;
    const vps1 = running.app.remote_by_name.vps1;
    await wait_until(() => (laptop.state.forwards_told !== null) && laptop.state.forwards_told.includes('"peer"') && (vps1.state.doors_told === doors_table(running.app, vps1).version) && (doors_table(running.app, vps1).streams !== undefined));
}

// A stream asked of a peer's agent by hand: the status it answered
function stream_ask(peer, target, token)
{
    return new Promise(function (resolve, reject) {
        const req = http.request({host: peer.addresses[0], port: peer.port, path: target, headers: {'connection': 'Upgrade', 'upgrade': 'serviceman-stream', 'x-serviceman-peer': token}});
        req.on('upgrade', function (res, socket) {
            socket.destroy();
            resolve({status: 101});
        });
        req.on('response', function (res) {
            res.resume();
            resolve({status: res.statusCode});
        });
        req.on('error', reject);
        req.end();
    });
}

function agents_stop(agents)
{
    for (const name of Object.keys(agents)) {
        agents[name].kill('SIGKILL');
    }
}

function agent_start(control_port, token, env)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-agent-'));
    const argv = [AGENT, '--url', `http://127.0.0.1:${control_port}`, '--token', token];
    const out = child_process.spawn(process.execPath, argv, {stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: dir}, env)});
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

// A port of the loopback nobody listens on now
function port_free_found()
{
    return new Promise(function (resolve) {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', function () {
            const found = server.address().port;
            server.close(function () {
                resolve(found);
            });
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

// What the page counts for a forward, or nothing before its first connection
function counted(running, label)
{
    const found = running.app.forward_counts[label];
    return (found === undefined) ? {} : found;
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
