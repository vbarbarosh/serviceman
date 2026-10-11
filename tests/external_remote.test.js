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

    // The link drops: not lost, not restarted, just not answering until the link is back
    agent.kill('SIGKILL');
    await until(() => remote.state.phase !== 'online');
    assert.strictEqual(app.service_by_name['logline-ui'].state.instances[0].phase, 'running');
    assert.strictEqual((await fetch_host({port, host: 'logline.test', path: '/'})).status, 502);
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
