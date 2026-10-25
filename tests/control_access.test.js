const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const control_allowed = require('../src/main/src/control_allowed');
const control_host_allowed = require('../src/main/src/control_host_allowed');
const control_same_origin = require('../src/main/src/control_same_origin');
const fetch_host = require('./fetch_host');
const file_log_from_env = require('../src/main/src/helpers/file_log_from_env');
const fs = require('fs');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const timers = require('timers/promises');
const ws = require('ws');

test('nothing is bound wider than the loopback unless the config says so', function () {
    const quiet = config_from_json({services: []}, '/srv');
    assert.strictEqual(quiet.listen.host, '127.0.0.1');
    assert.strictEqual(quiet.control.bind, '127.0.0.1');
    assert.strictEqual(quiet.control.exposed, false);

    const wide = config_from_json({listen: {host: '0.0.0.0'}, control: {bind: '0.0.0.0', exposed: true}, services: []}, '/srv');
    assert.strictEqual(wide.listen.host, '0.0.0.0');
    assert.strictEqual(wide.control.bind, '0.0.0.0');
    assert.strictEqual(wide.control.exposed, true);
});

test('the control page answers the machine it runs on, and no other caller', function () {
    const app = {config: config_from_json({services: []}, '/srv')};
    assert.strictEqual(control_allowed(app, {socket: {remoteAddress: '127.0.0.1'}}), true);
    assert.strictEqual(control_allowed(app, {socket: {remoteAddress: '::1'}}), true);
    assert.strictEqual(control_allowed(app, {socket: {remoteAddress: '::ffff:127.0.0.1'}}), true);
    assert.strictEqual(control_allowed(app, {socket: {remoteAddress: '203.0.113.5'}}), false);
    assert.strictEqual(control_allowed(app, {socket: {remoteAddress: '192.168.1.9'}}), false);

    const open = {config: config_from_json({control: {exposed: true}, services: []}, '/srv')};
    assert.strictEqual(control_allowed(open, {socket: {remoteAddress: '203.0.113.5'}}), true);
});

test('the control page answers its own names only, so a rebound name never reaches it', function () {
    const app = {config: config_from_json({control: {names: ['ops.example.com']}, services: []}, '/srv')};
    for (const host of ['localhost', '127.0.0.1:8081', '[::1]:8081', 'serviceman.localhost', 'ops.example.com']) {
        assert.strictEqual(control_host_allowed(app, {headers: {host}}), true, host);
    }
    for (const host of ['evil.example', 'rebound.test:8081', '']) {
        assert.strictEqual(control_host_allowed(app, {headers: {host}}), false, host);
    }
});

test('a strange name on the control port is a 404, and the agent file is still handed over', async function () {
    const running = await serviceman_start();
    try {
        const mine = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/status'});
        assert.strictEqual(mine.status, 200);

        const rebound = await fetch_host({port: running.control_port, host: 'evil.example', path: '/api/v1/status'});
        assert.strictEqual(rebound.status, 404);
        assert.match(rebound.body, /No service answers on this address/);
        assert.strictEqual(running.app.log_lines.some(v => /\[control_refused\] client=127\.0\.0\.1 host=evil\.example/.test(v)), true);

        const named = await fetch_host({port: running.control_port, host: 'serviceman.localhost', path: '/api/v1/status'});
        assert.strictEqual(named.status, 200);

        const agent = await fetch_host({port: running.control_port, host: 'evil.example', path: '/api/v1/agent.js'});
        assert.strictEqual(agent.status, 200, 'public code, and a far machine must be able to take it');
    }
    finally {
        await running.close();
    }
});

test('a browser is let through from the control page itself, and from no other site', function () {
    const host = 'serviceman.localhost:8081';
    assert.strictEqual(control_same_origin({headers: {host}}), true, 'curl and scripts name no site');
    assert.strictEqual(control_same_origin({headers: {host, 'sec-fetch-site': 'same-origin'}}), true);
    assert.strictEqual(control_same_origin({headers: {host, 'sec-fetch-site': 'none'}}), true);
    assert.strictEqual(control_same_origin({headers: {host, 'sec-fetch-site': 'cross-site'}}), false);
    assert.strictEqual(control_same_origin({headers: {host, 'sec-fetch-site': 'same-site'}}), false, 'a service on a neighbouring name is another site');
    assert.strictEqual(control_same_origin({headers: {host, origin: 'http://serviceman.localhost:8081'}}), true);
    assert.strictEqual(control_same_origin({headers: {host: 'localhost', origin: 'http://localhost:80'}}), true);
    assert.strictEqual(control_same_origin({headers: {host, origin: 'https://evil.example'}}), false);
    assert.strictEqual(control_same_origin({headers: {host, origin: 'http://serviceman.localhost:9999'}}), false);
    assert.strictEqual(control_same_origin({headers: {host, origin: 'null'}}), false);
});

test('a page on another site cannot change anything through the operator\'s browser', async function () {
    const running = await serviceman_start();
    const host = `localhost:${running.control_port}`;
    const body = JSON.stringify({service: {name: 'pwn', type: 'external', publish: {host: 'pwn.test'}, upstream: '127.0.0.1:1'}});
    try {
        const foreign = await fetch_host({port: running.control_port, host, path: '/api/v1/services', method: 'POST', body, headers: {'origin': 'https://evil.example', 'content-type': 'text/plain'}});
        assert.strictEqual(foreign.status, 403);
        assert.match(foreign.body, /a change comes from the control page itself/);
        const fetched = await fetch_host({port: running.control_port, host, path: '/api/v1/services', method: 'POST', body, headers: {'sec-fetch-site': 'cross-site'}});
        assert.strictEqual(fetched.status, 403);
        assert.strictEqual(running.app.service_by_name.pwn, undefined, 'nothing was created');
        assert.strictEqual(running.app.log_lines.some(v => /\[control_cross_site_refused\] client=127\.0\.0\.1 origin=https:\/\/evil\.example method=POST path=\/api\/v1\/services/.test(v)), true);

        const check = JSON.stringify({text: '{"services": []}'});
        const own = await fetch_host({port: running.control_port, host, path: '/api/v1/config/check', method: 'POST', body: check, headers: {'origin': `http://${host}`, 'sec-fetch-site': 'same-origin'}});
        assert.strictEqual(own.status, 200, 'the control page itself is let through');
        const read = await fetch_host({port: running.control_port, host, path: '/api/v1/status', headers: {'sec-fetch-site': 'cross-site'}});
        assert.strictEqual(read.status, 200, 'a read changes nothing, and the browser keeps its answer from the other site');
    }
    finally {
        await running.close();
    }
});

test('a page on another site cannot open a shell through the operator\'s browser', async function () {
    const running = await serviceman_start();
    const url = `ws://127.0.0.1:${running.control_port}/api/v1/shell?remote=nowhere`;
    try {
        const foreign = await shell_open(url, {origin: 'https://evil.example'});
        assert.strictEqual(foreign, 'refused');
        assert.strictEqual(running.app.log_lines.some(v => /\[shell_cross_site_refused\] from=127\.0\.0\.1 origin=https:\/\/evil\.example/.test(v)), true);
        const own = await shell_open(url, {origin: `http://127.0.0.1:${running.control_port}`});
        assert.strictEqual(own, 'open');
    }
    finally {
        await running.close();
    }
});

test('a visitor is told that it did not work, and the machine itself is told why', function () {
    const error_detail = require('../src/main/src/error_detail');
    const said = 'connect ECONNREFUSED 127.0.0.1:32783';
    const closed = {config: {control: {exposed: false}}};
    assert.strictEqual(error_detail(closed, {socket: {remoteAddress: '127.0.0.1'}}, said), said);
    assert.strictEqual(error_detail(closed, {socket: {remoteAddress: '::1'}}, said), said);
    assert.strictEqual(error_detail(closed, {socket: {remoteAddress: '203.0.113.5'}}, said), 'serviceman could not get an answer from it — the log on this host says why');

    // A serviceman whose control page is open to whoever reaches it has already decided who is
    // trusted; the reason a service did not start follows that decision rather than a second one
    const open = {config: {control: {exposed: true}}};
    assert.strictEqual(error_detail(open, {socket: {remoteAddress: '203.0.113.5'}}, said), said);
});

test('the address a visitor may poll says whether the service is up, and nothing else', async function () {
    const running = await serviceman_start([{name: 'site', type: 'external', publish: {host: 'site.test'}, upstream: '127.0.0.1:1'}]);
    try {
        const answer = await fetch_host({port: running.port, host: 'site.test', path: '/__serviceman__/status.json'});
        assert.strictEqual(answer.status, 200);
        assert.deepStrictEqual(JSON.parse(answer.body), {phase: 'running', doing: null, progress: null, progress_text: null, error: null, said: []}, 'the phase, why it failed, and what was said while it came up — and nothing about the machine');
    }
    finally {
        await running.close();
    }
});

test('the log says what happened without keeping what was said', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-log-'));
    const running = await serviceman_start([{name: 'site', type: 'external', publish: {host: 'site.test'}, upstream: '127.0.0.1:1'}]);
    running.app.file_log = file_log_from_env({SERVICEMAN_LOG_DIR: dir}, dir);
    try {
        await fetch_host({port: running.port, host: 'site.test', path: '/?password=hunter2'});
        await fetch_host({port: running.control_port, host: 'evil.example', path: '/api/v1/config?peek=1'});
        await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/services/site/start?note=hunter3', method: 'POST'});
        await timers.setTimeout(100);

        const lines = fs.readFileSync(path.join(dir, log_day()), 'utf8');
        assert.match(lines, /\[request_begin\] GET \/\?password=\*\*\* {"from":"","host":"site\.test","ip":"127\.0\.0\.1"}/);
        assert.strictEqual(lines.includes('hunter2'), false, 'the visitor\'s secret is not kept');
        assert.match(lines, /\[control_refused\] client=127\.0\.0\.1 host=evil\.example method=GET path=\/api\/v1\/config\?peek=\*\*\* reason=not_this_machine/);
        assert.match(lines, /\[control_change\] client=127\.0\.0\.1 method=POST path=\/api\/v1\/services\/site\/start\?note=\*\*\*/);
        assert.strictEqual(lines.includes('hunter3'), false, 'a change is written down without the values it carried');
    }
    finally {
        running.app.file_log.stream.end();
        await running.close();
    }
});

function shell_open(url, headers)
{
    return new Promise(function (resolve) {
        const client = new ws.WebSocket(url, {headers: Object.assign({authorization: `Bearer ${fetch_host.OWNER_TOKEN}`}, headers)});
        client.on('open', function () {
            client.terminate();
            resolve('open');
        });
        client.on('error', function () {
            resolve('refused');
        });
    });
}

function log_day()
{
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.log`;
}

async function serviceman_start(services)
{
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        services: (services === undefined) ? [] : services,
    }, __dirname);
    const app = app_from_config(config);
    const servers = await server_start(app);
    return {
        app,
        port: servers.server.address().port,
        control_port: servers.control.address().port,
        close: async function () {
            servers.server.close();
            servers.control.close();
            servers.server.closeAllConnections();
            servers.control.closeAllConnections();
        },
    };
}
