const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');

// The page's header has it from the status: the version in package.json, and nothing else
test('the status says which version of serviceman this is, for the header', async function (t) {
    const config = config_from_json({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: [], services: []}, __dirname);
    const app = app_from_config(config);
    app.state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-version-'));
    t.after(() => fs.rmSync(app.state_dir, {recursive: true, force: true}));
    const servers = await server_start(app);
    t.after(function () {
        for (const door of [servers.server, servers.control, servers.socket]) {
            if ((door !== undefined) && (door !== null)) {
                door.close();
            }
        }
    });
    const answer = await fetch_host({port: servers.control.address().port, host: '127.0.0.1', path: '/api/v1/status', method: 'GET', headers: {}});
    const version = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')).version;
    assert.deepStrictEqual(JSON.parse(answer.body).serviceman, {version});
});
