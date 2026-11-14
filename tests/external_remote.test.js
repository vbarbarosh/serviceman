const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const TOKEN = '0123456789abcdef0123456789abcdef';

test('an external service on a remote is reached through that remote\'s link, and nothing is started', async function (t) {
    // What already runs on that machine, on its own loopback: a viewer, say
    const viewer = http.createServer(function (req, res) {
        res.end(`viewer saw ${req.url} for ${req.headers.host}`);
    });
    await new Promise(v => viewer.listen(0, '127.0.0.1', v));
    t.after(() => viewer.close());
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: TOKEN}],
        services: [{name: 'logline-ui', type: 'external', remote: 'vps1', publish: {host: 'logline.test'}, upstream: `127.0.0.1:${viewer.address().port}`}],
    }, __dirname);
    const app = app_from_config(config);
    app.state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-external-'));
    const servers = await server_start(app);
    t.after(function () {
        for (const remote of app.remotes) {
            if (remote.state.socket !== null) {
                remote.state.socket.destroy();
            }
        }
        for (const door of [servers.server, servers.control]) {
            door.close();
            door.closeAllConnections();
        }
    });
    const port = servers.server.address().port;
    const remote = app.remote_by_name.vps1;

    // Its machine is away: the viewer answers on this very loopback, and still nothing is
    // passed to it, because the way to it is the link
    const away = await fetch_host({port, host: 'logline.test', path: '/'});
    assert.strictEqual(away.status, 502);

    const agent = child_process.spawn(process.execPath, [AGENT, '--url', `http://127.0.0.1:${servers.control.address().port}`, '--token', TOKEN], {stdio: 'ignore', env: Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: path.join(app.state_dir, 'agent')})});
    t.after(() => agent.kill('SIGKILL'));
    await until(() => remote.state.phase === 'online');
    const there = await fetch_host({port, host: 'logline.test', path: '/search?q=x'});
    assert.strictEqual(there.status, 200);
    assert.strictEqual(there.body, 'viewer saw /search?q=x for logline.test');
    assert.strictEqual(app.service_by_name['logline-ui'].state.instances[0].phase, 'running', 'nothing to start, nothing lost');

    // The viewer stops over there: the refusal names the machine, since its address is that
    // machine's loopback and not this one's
    const viewer_port = viewer.address().port;
    viewer.close();
    viewer.closeAllConnections();
    const refused = await fetch_host({port, host: 'logline.test', path: '/'});
    assert.strictEqual(refused.status, 502);
    // A connection kept open from the last request hangs up instead of being refused
    assert.match(refused.body, new RegExp(`(ECONNREFUSED 127\\.0\\.0\\.1:${viewer_port}|socket hang up), on vps1`));

    // The link drops: not lost, not restarted, just not answering until the link is back
    agent.kill('SIGKILL');
    await until(() => remote.state.phase !== 'online');
    assert.strictEqual(app.service_by_name['logline-ui'].state.instances[0].phase, 'running');
    const offline = await fetch_host({port, host: 'logline.test', path: '/'});
    assert.strictEqual(offline.status, 502);
    assert.strictEqual(offline.body.split('vps1').length - 1, 1, 'the machine is named once');
});

test('an external service names at most the one machine it is on', function () {
    const base = {listen: {host: '127.0.0.1', port: 0}, remotes: [{name: 'vps1', token: TOKEN}]};
    assert.throws(() => config_from_json(Object.assign({}, base, {services: [{name: 'x', type: 'external', remotes: ['vps1'], publish: {host: 'x.test'}, upstream: '127.0.0.1:1'}]}), __dirname), /^Error: services\[0\]\.remote: an external service runs where it already runs/);
    assert.throws(() => config_from_json(Object.assign({}, base, {services: [{name: 'x', type: 'external', remote: '#gpu', publish: {host: 'x.test'}, upstream: '127.0.0.1:1'}]}), __dirname), /\.remote: an external service/);
    assert.throws(() => config_from_json(Object.assign({}, base, {services: [{name: 'x', type: 'external', remote: 'vps9', publish: {host: 'x.test'}, upstream: '127.0.0.1:1'}]}), __dirname), /vps9/);
    const written = config_from_json(Object.assign({}, base, {services: [{name: 'x', type: 'external', remote: 'vps1', publish: {host: 'x.test'}, upstream: 'http://127.0.0.1:8081/'}]}), __dirname);
    assert.deepStrictEqual(written.services[0].upstream, {host: '127.0.0.1', port: 8081}, 'http://host:port says the same thing');
    for (const upstream of ['https://127.0.0.1:8081', 'http://127.0.0.1:8081/ui']) {
        assert.throws(() => config_from_json(Object.assign({}, base, {services: [{name: 'x', type: 'external', remote: 'vps1', publish: {host: 'x.test'}, upstream}]}), __dirname), /^Error: services\[0\]\.upstream: where it already answers, as host:port — plain http, no path/);
    }
});

async function until(ready)
{
    const deadline = Date.now() + 10000;
    while (ready() === false) {
        if (Date.now() > deadline) {
            throw new Error('the condition never came true');
        }
        await timers.setTimeout(25);
    }
}

// An app whose program listens on a socket file, added from Apps: serviceman passes every request
// into that file, on this host and on a machine of ours through its link, as a forward carries a
// connection. Its names are an app's; nothing is started, and nothing answers until the app
// listens.
test('an app on a socket file is reached in that file, here and on a machine', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-socket-'));
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: TOKEN}],
        services: [],
    }, null, 4));
    const config = config_from_json(JSON.parse(fs.readFileSync(config_path, 'utf8')), dir);
    config.path = config_path;
    const app = app_from_config(config);
    app.state_dir = path.join(dir, 'data');
    const servers = await server_start(app);
    t.after(function () {
        for (const remote of app.remotes) {
            if (remote.state.socket !== null) {
                remote.state.socket.destroy();
            }
        }
        for (const door of [servers.server, servers.control]) {
            door.close();
            door.closeAllConnections();
        }
        fs.rmSync(dir, {recursive: true, force: true});
    });
    const port = servers.server.address().port;
    const control = servers.control.address().port;
    function put(name, body) {
        return fetch_host({port: control, host: '127.0.0.1', path: `/api/v1/apps/${name}/socket`, method: 'PUT', body: JSON.stringify(body)});
    }

    // Here: nothing listens yet, so nothing answers; once the app listens, it answers
    const here = path.join(dir, 'here.sock');
    const made = await put('agency', {socket: here, remote: ''});
    assert.strictEqual(made.status, 201, made.body);
    assert.strictEqual(JSON.parse(made.body).address, `http://agency.localhost:${port}/`);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(config_path, 'utf8')).services, [{name: 'agency', type: 'external', publish: {host: 'agency.localhost'}, socket: here}]);
    assert.strictEqual((await fetch_host({port, host: 'agency.localhost', path: '/'})).status, 502);
    const app_here = http.createServer((req, res) => res.end(`here saw ${req.url} for ${req.headers.host}`));
    await new Promise(v => app_here.listen(here, v));
    t.after(() => app_here.close());
    const answered = await fetch_host({port, host: 'agency.localhost', path: '/notes?x=1'});
    assert.strictEqual(answered.status, 200);
    assert.strictEqual(answered.body, 'here saw /notes?x=1 for agency.localhost');

    // On a machine: the same app moved there, its socket in that machine's home
    const home = path.join(dir, 'home');
    fs.mkdirSync(home);
    const agent = child_process.spawn(process.execPath, [AGENT, '--url', `http://127.0.0.1:${control}`, '--token', TOKEN], {stdio: 'ignore', env: Object.assign({}, process.env, {HOME: home, SERVICEMAN_AGENT_DIR: path.join(dir, 'agent')})});
    t.after(() => agent.kill('SIGKILL'));
    await until(() => app.remote_by_name.vps1.state.phase === 'online');
    const app_there = http.createServer((req, res) => res.end(`there saw ${req.url}`));
    await new Promise(v => app_there.listen(path.join(home, 'agency.sock'), v));
    t.after(() => app_there.close());
    const moved = await put('agency', {socket: '~/agency.sock', remote: 'vps1'});
    assert.strictEqual(moved.status, 200, moved.body);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(config_path, 'utf8')).services[0], {name: 'agency', type: 'external', publish: {host: 'agency.localhost'}, remote: 'vps1', socket: '~/agency.sock'});
    const there = await fetch_host({port, host: 'agency.localhost', path: '/x'});
    assert.strictEqual(there.status, 200, there.body);
    assert.strictEqual(there.body, 'there saw /x');

    const refused = [
        [await put('agency', {socket: 'agency.sock'}), 400, 'the socket is the path of the file the app listens on, from / or from ~/ (got "agency.sock")'],
        [await put('agency', {socket: '~/a.sock', remote: 'vps9'}), 400, 'no machine named vps9 is in the config'],
        [await put('Bad.Name', {socket: '~/a.sock'}), 400, 'Bad.Name: an app\'s name is lowercase letters, digits, - and _'],
    ];
    for (const [answer, status, said] of refused) {
        assert.strictEqual(answer.status, status, answer.body);
        assert.strictEqual(JSON.parse(answer.body).error, said);
    }
});
