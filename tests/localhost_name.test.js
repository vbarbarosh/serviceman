const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const doors_from_env = require('../src/main/src/helpers/doors_from_env');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const http = require('http');
const localhost_name_allowed = require('../src/main/src/helpers/localhost_name_allowed');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const ws = require('ws');

const ON_A_MACHINE = {tailnet_on_loopback: false, published_on_loopback: false};
const IN_THE_IMAGE = {tailnet_on_loopback: true, published_on_loopback: true};

// A request as the helper sees it: where it came from, where it landed, what it brought
function request_of(socket, headers)
{
    return {socket, headers: headers || {}};
}

test('the image and bin/run say which way in is the tailnet and which this computer', function () {
    assert.deepStrictEqual(doors_from_env({}), ON_A_MACHINE);
    assert.deepStrictEqual(doors_from_env({SERVICEMAN_LOOPBACK: 'tailnet', SERVICEMAN_PUBLISHED: 'loopback'}), IN_THE_IMAGE);
    assert.deepStrictEqual(doors_from_env({SERVICEMAN_LOOPBACK: 'tailnet'}), {tailnet_on_loopback: true, published_on_loopback: false});
});

// A name under .localhost is this computer's own: on a machine that is its loopback; in the
// image the loopback is the tailnet, tailscaled's, and this computer is docker's published port
test('a .localhost name is answered to this computer only, wherever serviceman runs', function () {
    const machine = {doors: ON_A_MACHINE, load_test_keys: new Set()};
    assert.strictEqual(localhost_name_allowed(machine, request_of({remoteAddress: '127.0.0.1', localAddress: '127.0.0.1'})), true, 'its own loopback');
    assert.strictEqual(localhost_name_allowed(machine, request_of({remoteAddress: '::1', localAddress: '::1'})), true, 'its own loopback, IPv6');
    assert.strictEqual(localhost_name_allowed(machine, request_of({remoteAddress: '100.64.0.20', localAddress: '100.64.0.10'})), false, 'a tailnet device');
    assert.strictEqual(localhost_name_allowed(machine, request_of({remoteAddress: '192.0.2.7', localAddress: '192.0.2.1'})), false, 'the network');
    assert.strictEqual(localhost_name_allowed(machine, request_of({remoteAddress: undefined})), true, 'a socket file');
    assert.strictEqual(localhost_name_allowed(machine, request_of({remoteAddress: undefined, tunnel_from: 'vps1'})), false, 'a machine\'s door');

    const image = {doors: IN_THE_IMAGE, load_test_keys: new Set()};
    assert.strictEqual(localhost_name_allowed(image, request_of({remoteAddress: '127.0.0.1', localAddress: '127.0.0.1'})), false, 'tailscaled hands a tailnet device in on the loopback');
    assert.strictEqual(localhost_name_allowed(image, request_of({remoteAddress: '172.17.0.1', localAddress: '172.17.0.2'})), true, 'docker\'s port, published on the machine\'s loopback');
    const unsaid = {doors: {tailnet_on_loopback: true, published_on_loopback: false}, load_test_keys: new Set()};
    assert.strictEqual(localhost_name_allowed(unsaid, request_of({remoteAddress: '172.17.0.1', localAddress: '172.17.0.2'})), false, 'a port published nobody said where');

    image.load_test_keys.add('k3y');
    assert.strictEqual(localhost_name_allowed(image, request_of({remoteAddress: '127.0.0.1', localAddress: '127.0.0.1'}, {'x-serviceman-load-test': 'k3y'})), true, 'a load test of a running run');
    assert.strictEqual(localhost_name_allowed(image, request_of({remoteAddress: '127.0.0.1', localAddress: '127.0.0.1'}, {'x-serviceman-load-test': 'guess'})), false, 'a key no run holds');
});

// The whole way: a service at a .localhost name and the same one at another name, a request and a
// handshake to each, asked as tailscaled asks in the image (from the container's loopback)
test('in the image, a tailnet device that types a .localhost name gets the 404 of a name nobody has', async function (t) {
    const seen = [];
    const upstream = http.createServer(function (req, res) {
        seen.push(req.headers);
        res.end('hello');
    });
    await new Promise(function (resolve) {
        upstream.listen(0, '127.0.0.1', resolve);
    });
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-localhost-'));
    const before = process.env.SERVICEMAN_STATE_DIR;
    process.env.SERVICEMAN_STATE_DIR = state;
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        services: [{name: 'va', type: 'external', publish: {hosts: ['va.localhost', 'va.apps.example.com']}, upstream: `127.0.0.1:${upstream.address().port}`}],
    }, state);
    const app = app_from_config(config);
    const servers = await server_start(app);
    const port = servers.server.address().port;
    t.after(function () {
        servers.server.close();
        servers.control.close();
        servers.server.closeAllConnections();
        servers.control.closeAllConnections();
        upstream.close();
        process.env.SERVICEMAN_STATE_DIR = before;
        fs.rmSync(state, {recursive: true, force: true});
    });

    app.doors = ON_A_MACHINE;
    assert.strictEqual((await fetch_host({port, host: 'va.localhost', token: null})).status, 200, 'on a machine its loopback is this computer');

    app.doors = IN_THE_IMAGE;
    const refused = await fetch_host({port, host: 'va.localhost', token: null});
    assert.strictEqual(refused.status, 404);
    assert.match(refused.body, /No service answers on this address/);
    assert.ok(app.log_lines.some(v => v.includes('[localhost_refused]') && v.includes('va.localhost')), 'the log says who asked for which name');
    assert.strictEqual((await fetch_host({port, host: 'va.apps.example.com', token: null})).status, 200, 'its tailnet name is answered');
    assert.strictEqual((await fetch_host({port, host: 'serviceman.localhost', path: '/api/v1/status'})).status, 200, 'the control page keeps its own wall, its token');

    const handshake = await new Promise(function (resolve) {
        const client = new ws(`ws://127.0.0.1:${port}/`, {headers: {host: 'va.localhost'}});
        client.on('unexpected-response', (request, answer) => resolve(answer.statusCode));
        client.on('open', () => resolve('open'));
        client.on('error', () => resolve('error'));
    });
    assert.strictEqual(handshake, 404, 'a websocket is held to the same rule');

    app.load_test_keys.add('k3y');
    seen.length = 0;
    const load = await fetch_host({port, host: 'va.localhost', token: null, headers: {'x-serviceman-load-test': 'k3y'}});
    assert.strictEqual(load.status, 200, 'a load test brings its run\'s key');
    assert.strictEqual(seen[0]['x-serviceman-load-test'], undefined, 'the service never sees the key');
    app.load_test_keys.delete('k3y');
    assert.strictEqual((await fetch_host({port, host: 'va.localhost', token: null, headers: {'x-serviceman-load-test': 'k3y'}})).status, 404, 'a run that ended takes its key with it');
});
