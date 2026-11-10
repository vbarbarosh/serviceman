const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');

// A service may answer what no HTTP has: a status of 99, or of 0. Node's client takes those and
// node's server refuses to say them: thrown where the answer is passed on to the visitor, in a
// callback nothing catches, it ended serviceman, and every other service with it.
test('a service that answers with a status no HTTP has is a 502 for that visitor, and serviceman goes on', async function (t) {
    const said = ['099 Odd', '000 Zero', '204 No Content'];
    const service = net.createServer(function (socket) {
        socket.once('data', function () {
            socket.end(`HTTP/1.1 ${said.shift()}\r\ncontent-length: 0\r\nx-from: the-service\r\n\r\n`);
        });
    });
    await new Promise(function (resolve) {
        service.listen(0, '127.0.0.1', resolve);
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-proxy-'));
    const config = config_from_json({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: [], services: [{name: 'odd', type: 'external', publish: {host: 'odd.localhost'}, upstream: `127.0.0.1:${service.address().port}`}]}, dir);
    const app = app_from_config(config);
    app.state_dir = dir;
    const servers = await server_start(app);
    const log = console.log;
    console.log = function () {};
    t.after(function () {
        console.log = log;
        service.close();
        for (const door of [servers.server, servers.control]) {
            door.close();
            door.closeAllConnections();
        }
        fs.rmSync(dir, {recursive: true, force: true});
    });
    const port = servers.server.address().port;
    for (const status of [502, 502, 204]) {
        const answer = await fetch_host({port, host: 'odd.localhost', path: '/', token: null});
        // Nothing of the answer that was refused rides on the page that says so
        assert.deepStrictEqual([answer.status, (status === 204) ? 'the-service' : undefined], [status, answer.headers['x-from']]);
    }
    assert.strictEqual(app.log_lines.filter(v => v.includes('[upstream_error] service=odd') && v.includes('Invalid status code')).length, 2);
});
