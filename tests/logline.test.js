const agent_addresses = require('../src/agent/src/agent_addresses');
const app_apply_config = require('../src/main/src/helpers/app_apply_config');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const crypto = require('crypto');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const lines_serve = require('../logline/lines/src/lines_serve');
const logline_sweep = require('../src/main/src/helpers/logline_sweep');
const os = require('os');
const path = require('path');
const profile_from_db = require('../src/main/src/helpers/profile_from_db');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const TOKEN = '0123456789abcdef0123456789abcdef';
const ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');

test('the config says where Logline is, and which machines send their lines there', function () {
    const config = config_from_json({
        logline: {endpoint: 'http://logline:3000/lines', admin: 'logline'},
        remotes: [{name: 'vps1', token: TOKEN, logs: 'all'}, {name: 'vps2', token: TOKEN.split('').reverse().join('')}],
        services: [],
    }, __dirname);
    assert.deepStrictEqual(config.logline, {endpoint: 'http://logline:3000/lines', admin: 'logline', ui: null});
    assert.strictEqual(config_from_json({logline: {endpoint: 'http://logline:3000/lines', admin: 'logline', ui: 'http://logline:8081/'}, services: []}, __dirname).logline.ui, 'http://logline:8081/');
    assert.throws(() => config_from_json({logline: {endpoint: 'http://logline:3000/lines', admin: 'logline', ui: 'logline'}, services: []}, __dirname), /^Error: logline\.ui: the address of Logline's viewer/);
    assert.deepStrictEqual(config.remotes.map(v => v.logs), ['all', 'off'], 'a machine\'s logs stay on it until somebody says otherwise');
    assert.strictEqual(config_from_json({services: []}, __dirname).logline, null);
    assert.throws(() => config_from_json({logline: {endpoint: 'logline:3000', admin: 'logline'}, services: []}, __dirname), /^Error: logline\.endpoint: the address machines POST their lines to/);
    assert.throws(() => config_from_json({logline: {endpoint: 'http://logline:3000/lines'}, services: []}, __dirname), /^Error: logline\.admin: the name of the secret/);
    assert.throws(() => config_from_json({remotes: [{name: 'vps1', token: TOKEN, logs: true}], services: []}, __dirname), /^Error: remotes\[0\]\.logs: "all" sends every container's output/);
});

test('a machine switched on is told where to send and with which token, bound to its own addresses', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-logline-'));
    const agent_dir = path.join(dir, 'agent');
    const logline = await logline_start(t, path.join(dir, 'logline-tokens.json'));
    const json = {
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        logline: {endpoint: `http://127.0.0.1:${logline.port}/lines`, admin: 'logline'},
        remotes: [{name: 'vps1', token: TOKEN, logs: 'all'}],
        services: [],
    };
    const running = await serviceman_start(t, json, path.join(dir, 'state'));
    fs.writeFileSync(path.join(dir, 'state', 'secrets.json'), JSON.stringify({global: {logline: ADMIN_TOKEN}}));
    const remote = running.app.remote_by_name.vps1;
    const agent = agent_start(t, running.control_port, agent_dir);

    await wait_until(() => remote.state.logline_floor !== null);
    const told = JSON.parse(fs.readFileSync(path.join(agent_dir, 'logline', 'settings.json'), 'utf8'));
    assert.strictEqual(told.endpoint, json.logline.endpoint);
    assert.strictEqual(told.logs, 'all');
    assert.strictEqual(told.floor, remote.state.logline_floor);
    assert.strictEqual(Date.now() - Date.parse(told.floor) < 10000, true, 'the floor is the moment it was switched on');
    assert.strictEqual(fs.statSync(path.join(agent_dir, 'logline', 'settings.json')).mode & 0o777, 0o600, 'the token lets this machine write to the log');

    // Logline issued it for this machine's own addresses, and serviceman kept what it was given
    const issued = JSON.parse(fs.readFileSync(path.join(dir, 'logline-tokens.json'), 'utf8')).tokens;
    assert.deepStrictEqual(issued.map(v => [v.name, v.token, v.ips]), [['vps1', told.token, agent_addresses()]]);
    const kept = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'logline_tokens.json'), 'utf8'));
    assert.strictEqual(kept.vps1.token, told.token);
    assert.strictEqual(fs.statSync(path.join(dir, 'state', 'logline_tokens.json')).mode & 0o777, 0o600);
    // From an address it was not issued for, the token lets nothing in
    const elsewhere = await fetch(json.logline.endpoint, {method: 'POST', headers: {authorization: `Bearer ${told.token}`}, body: '[]'});
    assert.strictEqual(elsewhere.status, agent_addresses().includes('127.0.0.1') ? 200 : 401);

    // Switched off, then on again: the link stays up, and the floor is the new moment
    const socket = remote.state.socket;
    await app_apply_config(running.app, config_from_json(Object.assign({}, json, {remotes: [{name: 'vps1', token: TOKEN, logs: 'off'}]}), __dirname));
    await wait_until(() => remote.state.logline_floor === null);
    assert.strictEqual(remote.state.socket, socket, 'nothing about the machine changed, so it does not dial in again');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(agent_dir, 'logline', 'settings.json'), 'utf8')), {endpoint: null, token: null, logs: 'off', floor: null, dirs: []});
    await timers.setTimeout(5);
    await app_apply_config(running.app, config_from_json(json, __dirname));
    await wait_until(() => remote.state.logline_floor !== null);
    assert.strictEqual(remote.state.logline_floor > told.floor, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(agent_dir, 'logline', 'settings.json'), 'utf8')).token, told.token, 'the same machine at the same addresses keeps its token');

    // A second agent process on the same machine is told again, and the floor holds
    agent.kill('SIGKILL');
    await wait_until(() => remote.state.phase !== 'online');
    const floor = remote.state.logline_floor;
    const told_lines = running.app.log_lines.filter(v => v.includes('[logline_told]')).length;
    agent_start(t, running.control_port, agent_dir);
    await wait_until(() => (remote.state.phase === 'online') && (remote.state.logline_told !== null));
    assert.strictEqual(remote.state.logline_floor, floor, 'a restart is not a new switch-on: nothing between the two may be skipped');
    await timers.setTimeout(100);
    assert.strictEqual(running.app.log_lines.filter(v => v.includes('[logline_told]')).length, told_lines, 'it said what it knows at hello, and nothing needed telling');

    // Taken out of the config, the machine has its token taken back
    await app_apply_config(running.app, config_from_json(Object.assign({}, json, {remotes: []}), __dirname));
    await wait_until(() => JSON.parse(fs.readFileSync(path.join(dir, 'logline-tokens.json'), 'utf8')).tokens.length === 0);
    assert.strictEqual(running.app.log_lines.some(v => /\[logline_token_revoked\] remote=vps1/.test(v)), true);
});

test('a machine whose logs stay on it is not told anything at every hello', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-logline-'));
    const running = await serviceman_start(t, {
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: TOKEN}],
        services: [],
    }, path.join(dir, 'state'));
    const remote = running.app.remote_by_name.vps1;
    agent_start(t, running.control_port, path.join(dir, 'agent'));
    await wait_until(() => remote.state.phase === 'online');
    await logline_sweep(running.app);
    assert.strictEqual(running.app.log_lines.some(v => /logline/.test(v)), false);
    assert.strictEqual(fs.existsSync(path.join(dir, 'agent', 'logline')), false);
});

test('a Logline that is away is said once, and the machine is told when it is back', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-logline-'));
    const agent_dir = path.join(dir, 'agent');
    const json = {
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        logline: {endpoint: 'http://127.0.0.1:9/lines', admin: 'logline'},
        remotes: [{name: 'vps1', token: TOKEN, logs: 'all'}],
        services: [],
    };
    const running = await serviceman_start(t, json, path.join(dir, 'state'));
    const remote = running.app.remote_by_name.vps1;
    agent_start(t, running.control_port, agent_dir);

    // No admin token in the Secrets library yet
    await wait_until(() => remote.state.logline_error !== null);
    assert.match(remote.state.logline_error, /the Secrets library has no "logline"/);
    fs.writeFileSync(path.join(dir, 'state', 'secrets.json'), JSON.stringify({global: {logline: ADMIN_TOKEN}}));
    await logline_sweep(running.app);
    assert.match(remote.state.logline_error, /^Logline at http:\/\/127\.0\.0\.1:9 did not answer/);
    await logline_sweep(running.app);
    assert.strictEqual(running.app.log_lines.filter(v => /\[logline_tell_error\] remote=vps1 reason="Logline at/.test(v)).length, 1, 'the same reason is said once');
    assert.strictEqual(fs.existsSync(path.join(agent_dir, 'logline', 'settings.json')), false, 'nothing is told that is not so');

    // Logline comes up where the config says it is
    const logline = await logline_start(t, path.join(dir, 'logline-tokens.json'));
    await app_apply_config(running.app, config_from_json(Object.assign({}, json, {logline: {endpoint: `http://127.0.0.1:${logline.port}/lines`, admin: 'logline'}}), __dirname));
    await wait_until(() => remote.state.logline_floor !== null);
    assert.strictEqual(remote.state.logline_error, null);
});

test('the Logs tab switches a machine by writing its entry in the config', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-logline-'));
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: TOKEN}],
        services: [],
    }));
    const app = app_from_config(await profile_from_db(config_path));
    app.state_dir = path.join(dir, 'state');
    const servers = await server_start(app);
    t.after(function () {
        for (const door of [servers.server, servers.control]) {
            door.close();
            door.closeAllConnections();
        }
    });
    const port = servers.control.address().port;

    assert.strictEqual((await logs_put(port, 'vps1', {logs: 'all'})).status, 200);
    assert.strictEqual(JSON.parse(fs.readFileSync(config_path, 'utf8')).remotes[0].logs, 'all');
    assert.strictEqual(app.remote_by_name.vps1.logs, 'all');
    assert.strictEqual((await logs_put(port, 'vps1', {logs: 'off'})).status, 200);
    assert.strictEqual('logs' in JSON.parse(fs.readFileSync(config_path, 'utf8')).remotes[0], false, 'off is what an entry without it means');
    assert.strictEqual(app.remote_by_name.vps1.logs, 'off');
    assert.strictEqual((await logs_put(port, 'vps1', {logs: 'some'})).status, 400);

    // Folders are written with it, and taken away with an empty list
    assert.strictEqual((await logs_put(port, 'vps1', {dirs: [{path: '/var/log/nginx/*.log', service: 'nginx'}, {path: '~/app/logs', service: ''}]})).status, 200);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(config_path, 'utf8')).remotes[0].log_dirs, [{path: '/var/log/nginx/*.log', service: 'nginx'}, {path: '~/app/logs'}]);
    assert.deepStrictEqual(app.remote_by_name.vps1.log_dirs, [{path: '/var/log/nginx/*.log', service: 'nginx'}, {path: '~/app/logs', service: null}]);
    const relative = await logs_put(port, 'vps1', {dirs: [{path: 'logs'}]});
    assert.strictEqual(relative.status, 400);
    assert.match(relative.body.error, /log_dirs\[0\]\.path: a folder on that machine, from \/ or ~\//);
    assert.strictEqual((await logs_put(port, 'vps1', {dirs: []})).status, 200);
    assert.strictEqual('log_dirs' in JSON.parse(fs.readFileSync(config_path, 'utf8')).remotes[0], false);
    assert.strictEqual((await logs_put(port, 'vps9', {logs: 'all'})).status, 404);
});

test('Logline is entered on the page: the address in the config, the admin token in the Secrets library', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-logline-'));
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: TOKEN}],
        services: [],
    }));
    const app = app_from_config(await profile_from_db(config_path));
    app.state_dir = path.join(dir, 'state');
    const servers = await server_start(app);
    t.after(function () {
        for (const door of [servers.server, servers.control]) {
            door.close();
            door.closeAllConnections();
        }
    });
    const port = servers.control.address().port;

    assert.strictEqual((await logline_put(port, {endpoint: 'http://logline:3000/lines', admin_token: ADMIN_TOKEN, ui: 'http://logline:8081/'})).status, 200);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(config_path, 'utf8')).logline, {endpoint: 'http://logline:3000/lines', admin: 'logline', ui: 'http://logline:8081/'});
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'state', 'secrets.json'), 'utf8')).global.logline, ADMIN_TOKEN);
    assert.strictEqual(fs.readFileSync(config_path, 'utf8').includes(ADMIN_TOKEN), false, 'the token is never in the config');
    assert.deepStrictEqual(app.config.logline, {endpoint: 'http://logline:3000/lines', admin: 'logline', ui: 'http://logline:8081/'});

    // Saved again with the token left empty: the one kept stays, and the viewer goes
    assert.strictEqual((await logline_put(port, {endpoint: 'http://logline:3000/lines', admin_token: ''})).status, 200);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'state', 'secrets.json'), 'utf8')).global.logline, ADMIN_TOKEN);
    assert.strictEqual(app.config.logline.ui, null);

    // A wrong address is refused, and nothing is kept on its way
    const wrong = await logline_put(port, {endpoint: 'logline:3000', admin_token: 'another'});
    assert.strictEqual(wrong.status, 400);
    assert.match(wrong.body.error, /^logline\.endpoint:/);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'state', 'secrets.json'), 'utf8')).global.logline, ADMIN_TOKEN);

    // An empty address takes Logline away
    assert.strictEqual((await logline_put(port, {endpoint: ''})).status, 200);
    assert.strictEqual('logline' in JSON.parse(fs.readFileSync(config_path, 'utf8')), false);
    assert.strictEqual(app.config.logline, null);
});

// What the Logs tab sends when Logline's address is saved
async function logline_put(port, body)
{
    const answer = await fetch_host({port, host: '127.0.0.1', path: '/api/v1/logline', method: 'PUT', body: JSON.stringify(body)});
    return {status: answer.status, body: JSON.parse(answer.body)};
}

// What the Logs tab sends when a machine is switched
async function logs_put(port, name, body)
{
    const answer = await fetch_host({port, host: '127.0.0.1', path: `/api/v1/remotes/${name}/logs`, method: 'PUT', body: JSON.stringify(body)});
    return {status: answer.status, body: JSON.parse(answer.body)};
}

async function logline_start(t, tokens_file)
{
    const server = lines_serve({admin_token: ADMIN_TOKEN, admin_ips: ['127.0.0.1'], clickhouse: 'http://127.0.0.1:9', table: 'default.otel_logs', tokens_file, uid: 'ctest0000000'});
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(function () {
        server.closeAllConnections();
        server.close();
    });
    return {port: server.address().port};
}

async function serviceman_start(t, json, state_dir)
{
    const app = app_from_config(config_from_json(json, __dirname));
    app.state_dir = state_dir;
    fs.mkdirSync(state_dir, {recursive: true});
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
    return {app, control_port: servers.control.address().port};
}

function agent_start(t, control_port, dir)
{
    const argv = [AGENT, '--url', `http://127.0.0.1:${control_port}`, '--token', TOKEN];
    const out = child_process.spawn(process.execPath, argv, {stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: dir})});
    out.stdout.resume();
    out.stderr.resume();
    t.after(() => out.kill('SIGKILL'));
    return out;
}

async function wait_until(ready)
{
    const deadline = Date.now() + 10000;
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
