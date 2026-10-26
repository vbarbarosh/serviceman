const agent_built = require('../src/agent/src/agent_built');
const agent_shared = require('../src/agent/src/agent_shared');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fake_shared_machine = require('./fake_shared_machine');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const TOKEN_HOME = 'token-of-the-home-0123456789';
const TOKEN_WEB = 'token-of-the-web-0123456789a';
const DIR = '/var/lib/serviceman/shared';

// Two machines with their agents, each with a root half of the test's own that does the shared
// folder work on a fake machine: the page's requests go the whole way, through serviceman, the
// link and the agent, to the commands the machine would run
test('a home is set up, a folder made and mounted read-only on another machine; the page never sees a secret', async function (t) {
    const world = await world_start(t);
    const home_machine = world.machines.vps1;
    const web_machine = world.machines.vps2;

    const empty = await control(world, 'GET', '/api/v1/shared-folders');
    assert.strictEqual(empty.status, 200);
    assert.strictEqual(empty.body.home, null);
    assert.deepStrictEqual(empty.body.machines.map(v => `${v.name} ${v.home_why}`), ['vps1 null', 'vps2 has no tailnet address for the other machines to reach it at']);
    const nowhere = await control(world, 'POST', '/api/v1/shared-folders/home', {remote: 'vps2'});
    assert.strictEqual(nowhere.status, 409);

    const set = await control(world, 'POST', '/api/v1/shared-folders/home', {remote: 'vps1'});
    assert.strictEqual(set.status, 202);
    assert.strictEqual(set.body.home.phase, 'setting_up');
    const ready = await view_until(world, v => (v.home.phase === 'ready'));
    assert.strictEqual(ready.home.address, '100.64.0.20');
    assert.ok(home_machine.formatted);
    assert.ok(home_machine.containers['serviceman-shared-redis'].argv.includes('100.64.0.20:16379:6379'));
    const twice = await control(world, 'POST', '/api/v1/shared-folders/home', {remote: 'vps1'});
    assert.strictEqual(twice.status, 409);

    const made = await control(world, 'POST', '/api/v1/shared-folders/folders', {name: 'media'});
    assert.strictEqual(made.status, 200, JSON.stringify(made.body));
    assert.deepStrictEqual(made.body.folders.map(v => v.name), ['media']);
    assert.deepStrictEqual(home_machine.folders[`${DIR}/all`], ['media']);
    const same = await control(world, 'POST', '/api/v1/shared-folders/folders', {name: 'media'});
    assert.strictEqual(same.status, 409);
    const odd = await control(world, 'POST', '/api/v1/shared-folders/folders', {name: 'Media Files'});
    assert.strictEqual(odd.status, 400);

    const put = await control(world, 'PUT', '/api/v1/shared-folders/folders/media/mounts/vps2', {path: '/srv/media', mode: 'ro'});
    assert.strictEqual(put.status, 200);
    const mounted = await view_until(world, v => (v.folders[0].mounts[0].state === 'mounted'));
    assert.deepStrictEqual(mounted.folders[0].mounts.map(v => `${v.remote} ${v.path} ${v.mode} ${v.state}`), ['vps2 /srv/media ro mounted']);
    const mount = web_machine.ran.find(v => v.argv[1] === 'mount');
    assert.ok(mount.argv.includes('--read-only'));
    assert.strictEqual(mount.argv[mount.argv.indexOf('--subdir') + 1], '/media');
    assert.ok(mount.argv.includes('redis://100.64.0.20:16379/1'));

    // The attacker's story: the secrets are kept by serviceman at 0600 and given to machines;
    // no answer to the page carries one, and no machine ran one in an argv
    const kept_file = path.join(world.state_dir, 'shared_folders.json');
    assert.strictEqual(fs.statSync(kept_file).mode & 0o777, 0o600);
    const secrets = Object.values(JSON.parse(fs.readFileSync(kept_file, 'utf8')).home.secrets);
    assert.strictEqual(secrets.length, 5);
    const answers = JSON.stringify([set.body, ready, made.body, put.body, mounted]);
    assert.deepStrictEqual(secrets.filter(v => answers.includes(v)), []);
    const argvs = JSON.stringify(home_machine.ran.concat(web_machine.ran).map(v => v.argv));
    assert.deepStrictEqual(secrets.filter(v => argvs.includes(v)), []);
    assert.strictEqual(mount.env.META_PASSWORD, JSON.parse(fs.readFileSync(kept_file, 'utf8')).home.secrets.redis_password);

    // A path of the system's own, or one where another folder is, is refused
    for (const where of ['/etc/media', '/', '/srv', 'srv/media']) {
        const refused = await control(world, 'PUT', '/api/v1/shared-folders/folders/media/mounts/vps1', {path: where, mode: 'rw'});
        assert.strictEqual(refused.status, 400, where);
    }
    const bad_mode = await control(world, 'PUT', '/api/v1/shared-folders/folders/media/mounts/vps1', {path: '/srv/media', mode: 'write'});
    assert.strictEqual(bad_mode.status, 400);
    await control(world, 'POST', '/api/v1/shared-folders/folders', {name: 'docs'});
    const over = await control(world, 'PUT', '/api/v1/shared-folders/folders/docs/mounts/vps2', {path: '/srv/media/docs', mode: 'rw'});
    assert.strictEqual(over.status, 409);

    // Deleted only once mounted nowhere, and only with its name typed again
    const busy = await control(world, 'DELETE', '/api/v1/shared-folders/folders/media', {name: 'media'});
    assert.strictEqual(busy.status, 409);
    assert.match(busy.body.error, /mounted on vps2/);
    const unmounted = await control(world, 'DELETE', '/api/v1/shared-folders/folders/media/mounts/vps2');
    assert.strictEqual(unmounted.status, 200);
    await wait_until(() => web_machine.mounts.length === 0);
    const untyped = await control(world, 'DELETE', '/api/v1/shared-folders/folders/media', {name: 'medi'});
    assert.strictEqual(untyped.status, 400);
    const deleted = await control(world, 'DELETE', '/api/v1/shared-folders/folders/media', {name: 'media'});
    assert.strictEqual(deleted.status, 200, JSON.stringify(deleted.body));
    assert.deepStrictEqual(deleted.body.folders.map(v => v.name), ['docs']);
    assert.ok(home_machine.ran.some(v => v.line === `juicefs-1.4.2 rmr ${DIR}/all/media`));
});

test('a machine that is away is told its mounts when it comes back, and the row says it waits until then', async function (t) {
    const world = await world_start(t);
    await control(world, 'POST', '/api/v1/shared-folders/home', {remote: 'vps1'});
    await view_until(world, v => (v.home.phase === 'ready'));
    await control(world, 'POST', '/api/v1/shared-folders/folders', {name: 'media'});
    world.agents.vps2.kill();
    await wait_until(() => world.app.remote_by_name.vps2.state.phase !== 'online');
    const put = await control(world, 'PUT', '/api/v1/shared-folders/folders/media/mounts/vps2', {path: '/srv/media', mode: 'rw'});
    assert.strictEqual(put.status, 200);
    const waiting = await control(world, 'GET', '/api/v1/shared-folders');
    assert.strictEqual(waiting.body.folders[0].mounts[0].state, 'waiting');
    assert.match(waiting.body.folders[0].mounts[0].error, /waits for vps2 to come online/);
    assert.strictEqual(world.machines.vps2.mounts.length, 0);
    world.agents.vps2 = agent_start(world, 'vps2');
    const mounted = await view_until(world, v => (v.folders[0].mounts[0].state === 'mounted'));
    assert.strictEqual(mounted.folders[0].mounts[0].path, '/srv/media');
    assert.deepStrictEqual(world.machines.vps2.mounts.map(v => v.point), ['/srv/media']);
});

test('a path that holds files is shown refused in its row, with the reason', async function (t) {
    const world = await world_start(t);
    world.machines.vps2.folders['/srv/site'] = ['index.html'];
    await control(world, 'POST', '/api/v1/shared-folders/home', {remote: 'vps1'});
    await view_until(world, v => (v.home.phase === 'ready'));
    await control(world, 'POST', '/api/v1/shared-folders/folders', {name: 'media'});
    await control(world, 'PUT', '/api/v1/shared-folders/folders/media/mounts/vps2', {path: '/srv/site', mode: 'rw'});
    const refused = await view_until(world, v => (v.folders[0].mounts[0].state === 'not_empty'));
    assert.match(refused.folders[0].mounts[0].error, /\/srv\/site has files of its own \(index\.html\)/);
});

test('without a token of the owner\'s the shared folders answer nothing', async function (t) {
    const world = await world_start(t);
    const answer = await fetch_host({port: world.control_port, host: '127.0.0.1', path: '/api/v1/shared-folders', token: null});
    assert.strictEqual(answer.status, 401);
});

async function world_start(t)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-folders-'));
    const state_dir = path.join(dir, 'state');
    process.env.SERVICEMAN_STATE_DIR = state_dir;
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: TOKEN_HOME}, {name: 'vps2', token: TOKEN_WEB}],
        services: [],
    }, dir);
    const app = app_from_config(config);
    delete process.env.SERVICEMAN_STATE_DIR;
    const servers = await server_start(app);
    const out = {app, servers, dir, state_dir: app.state_dir, control_port: servers.control.address().port, machines: {}, roots: {}, agents: {}};
    for (const name of ['vps1', 'vps2']) {
        out.machines[name] = fake_shared_machine();
        out.roots[name] = await root_start(path.join(dir, `${name}-root.sock`), out.machines[name]);
        out.agents[name] = agent_start(out, name);
    }
    t.after(async function () {
        for (const name of Object.keys(out.agents)) {
            out.agents[name].kill();
        }
        for (const name of Object.keys(out.roots)) {
            out.roots[name].close();
        }
        for (const remote of app.remotes) {
            if (remote.state.socket !== null) {
                remote.state.socket.destroy();
            }
        }
        for (const door of [servers.server, servers.control, servers.socket]) {
            if ((door !== null) && (door !== undefined)) {
                door.close();
                door.closeAllConnections();
            }
        }
        fs.rmSync(dir, {recursive: true, force: true});
    });
    await wait_until(() => app.remotes.every(v => (v.state.phase === 'online') && v.state.resources.can.includes('root')), 15000);
    // The home's tailnet address, which this machine has none of
    app.remote_by_name.vps1.state.resources.addresses = ['192.0.2.10', '100.64.0.20'];
    return out;
}

// A root half of the test's own on a socket: the ping the agent asks before it says it has one,
// and the shared folder work, on the fake machine
function root_start(socket, machine)
{
    const server = net.createServer(function (conn) {
        let rest = '';
        conn.on('error', () => {});
        conn.on('data', async function on_data(chunk) {
            rest += chunk.toString('utf8');
            if (rest.includes('\n') === false) {
                return;
            }
            conn.off('data', on_data);
            const job = JSON.parse(rest.slice(0, rest.indexOf('\n')));
            if (job.method === 'ping') {
                conn.end(`${JSON.stringify({type: 'reply', ok: true, value: {at: Date.now(), root: true, built: agent_built, supervised: false}})}\n`);
                return;
            }
            if (job.method !== 'shared') {
                conn.end(`${JSON.stringify({type: 'reply', ok: false, error: `the root agent knows nothing called "${job.method}"`})}\n`);
                return;
            }
            const value = await agent_shared({shared_dir: DIR, root_for: 'user'}, job.params, null, machine.system);
            conn.end(`${JSON.stringify({type: 'reply', ok: true, value})}\n`);
        });
    });
    return new Promise(function (resolve) {
        server.listen(socket, function () {
            resolve(server);
        });
    });
}

function agent_start(world, name)
{
    const token = (name === 'vps1') ? TOKEN_HOME : TOKEN_WEB;
    const argv = [AGENT, '--url', `http://127.0.0.1:${world.control_port}`, '--token', token, '--root-socket', path.join(world.dir, `${name}-root.sock`), '--peer-port', '0'];
    const env = Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: path.join(world.dir, `${name}-agent`), SERVICEMAN_LOG_TIME: 'off'});
    const out = child_process.spawn(process.execPath, argv, {stdio: ['ignore', 'pipe', 'pipe'], env});
    out.stdout.resume();
    out.stderr.resume();
    return out;
}

async function control(world, method, path_asked, value)
{
    // With its length, as a browser sends it: node sends a DELETE's body with none
    const body = (value === undefined) ? undefined : JSON.stringify(value);
    const headers = (body === undefined) ? {} : {'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body))};
    const answer = await fetch_host({port: world.control_port, host: '127.0.0.1', path: path_asked, method, headers, body});
    return {status: answer.status, body: JSON.parse(answer.body)};
}

// The page's view, read until it shows what the test waits for
async function view_until(world, ready)
{
    let last = null;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        last = (await control(world, 'GET', '/api/v1/shared-folders')).body;
        try {
            if (ready(last)) {
                return last;
            }
        }
        catch {
            // A view that does not have the part asked about yet
        }
        await timers.setTimeout(100);
    }
    throw new Error(`the view never came to it: ${JSON.stringify(last)}`);
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
