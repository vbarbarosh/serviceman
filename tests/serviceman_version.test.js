const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');

const HELPER = path.resolve(__dirname, '../src/main/src/helpers/serviceman_version');
const VERSION = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')).version;

// What a fresh serviceman says of itself, with this environment
function version_with(env)
{
    const said = child_process.execFileSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(HELPER)})()))`], {env: Object.assign({}, process.env, env), encoding: 'utf8'});
    return JSON.parse(said);
}

// The image has its commit from bin/build, which wins over anything git would say; without it, a
// checkout asks git, a commit of seven letters and a + when there are changes not committed
test('serviceman says its version and the commit it was built from, the one bin/build hands in first', function () {
    assert.deepStrictEqual(version_with({SERVICEMAN_COMMIT: 'abc1234+'}), {version: VERSION, commit: 'abc1234+'});
    const asked = version_with({SERVICEMAN_COMMIT: ''});
    assert.strictEqual(asked.version, VERSION);
    assert.ok((asked.commit === null) || /^[0-9a-f]{7}\+?$/.test(asked.commit), asked.commit);
});

// The page's header has it from the status
test('the status says which serviceman this is, for the header', async function (t) {
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
    const status = JSON.parse(answer.body);
    assert.strictEqual(status.serviceman.version, VERSION);
    assert.ok(Object.hasOwn(status.serviceman, 'commit'));
});
