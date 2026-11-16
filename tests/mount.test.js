const agent_mounts_set = require('../src/agent/src/agent_mounts_set');
const agent_root_current = require('../src/agent/src/agent_root_current');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const crypto = require('crypto');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const link_read = require('../src/helpers/link_read');
const mount_join = require('../src/main/src/helpers/mount_join');
const net = require('net');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const sftp_client = require('./sftp_client');
const stream = require('stream');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const TOKEN_LAPTOP = 'cccccccccccccccccccccccccccccccc';
const TOKEN_VPS = 'dddddddddddddddddddddddddddddddd';
const FX_PERMISSION_DENIED = 3;

// The author's case, the other way round too: a folder of the laptop shows up on vps1. vps1's
// agent listens on the mount's socket and hands the table to its root half; sshfs's "ssh", the
// agent's own --pipe, speaks SFTP through vps1's link, serviceman and the laptop's link to the
// folder, which it sees read-only and nothing outside of.
test('a folder of the laptop is read on vps1 through the mount\'s pipe, read-only', async function (t) {
    const base = dir_make(t);
    const folder = path.join(base, 'photos');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'cat.txt'), 'meow\n');
    fs.writeFileSync(path.join(base, 'secret.txt'), 'outside\n');
    const running = await serviceman_start(t, [
        {label: 'photos', from: {remote: 'laptop', path: folder}, to: {remote: 'vps1', path: '/mnt/photos'}, mode: 'ro'},
    ]);
    const root = await root_fake(t, base);
    agents_start(t, running, base, root.file);
    await wait_until(() => (root.tables.length > 0) && online(running));

    const told = root.tables[root.tables.length - 1].mounts;
    assert.deepStrictEqual(told.map(v => `${v.label} ${v.path} ${v.mode}`), ['photos /mnt/photos ro']);
    assert.strictEqual(told[0].socket, socket_of(base, 'vps1', 'photos'));
    assert.strictEqual(fs.statSync(told[0].socket).mode & 0o777, 0o600, 'nobody but the agent\'s user may dial it');

    const client = await pipe_open(t, told[0].socket);
    assert.deepStrictEqual((await client.names('/')).filter(v => (v !== '.') && (v !== '..')), ['cat.txt']);
    assert.strictEqual(await client.read_file('/cat.txt'), 'meow\n');
    assert.strictEqual((await client.write_file('/new.txt', 'x')).code, FX_PERMISSION_DENIED);
    assert.strictEqual((await client.open('/../secret.txt', 1)).code, 2);
    assert.strictEqual(fs.existsSync(path.join(folder, 'new.txt')), false);

    await wait_until(() => (running.app.remote_by_name.vps1.state.mounts_said !== null));
    const view = (await state_read(running)).mounts[0];
    assert.strictEqual(view.label, 'photos');
    assert.strictEqual(view.state, 'mounted');
    assert.strictEqual(view.problem, null);
    assert.ok(view.total >= 1);
    assert.ok(view.bytes_back > 0);
});

// serviceman's own data/, mounted read-write on a machine: serviceman serves its state dir itself
test('serviceman\'s own state dir is mounted on a machine, read-write, and nothing above it', async function (t) {
    const base = dir_make(t);
    const state_dir = path.join(base, 'data');
    fs.mkdirSync(state_dir);
    fs.writeFileSync(path.join(state_dir, 'serviceman.json'), '{}\n');
    const running = await serviceman_start(t, [
        {label: 'serviceman\'s data', from: {here: true, path: '.'}, to: {remote: 'vps1', path: '/mnt/serviceman'}, mode: 'rw'},
    ], state_dir);
    const root = await root_fake(t, base);
    agents_start(t, running, base, root.file);
    await wait_until(() => (root.tables.length > 0) && online(running));

    const client = await pipe_open(t, root.tables[root.tables.length - 1].mounts[0].socket);
    assert.strictEqual(await client.read_file('/serviceman.json'), '{}\n');
    assert.strictEqual(await client.realpath('../..'), '/');
    assert.strictEqual((await client.write_file('/note.txt', 'hello')).code, 0);
    assert.strictEqual(fs.readFileSync(path.join(state_dir, 'note.txt'), 'utf8'), 'hello');
});

// A machine that names a mount that is not its own is asking for a folder that is not its to see
test('only the machine a mount is on may open it, and only while it is on', async function (t) {
    const base = dir_make(t);
    const running = await serviceman_start(t, [
        {label: 'photos', from: {remote: 'laptop', path: base}, to: {remote: 'vps1', path: '/mnt/photos'}, mode: 'ro'},
        {label: 'aside', from: {remote: 'laptop', path: base}, to: {remote: 'vps1', path: '/mnt/aside'}, mode: 'ro', off: true},
    ]);
    const frames = [];
    const link = new stream.PassThrough();
    link_read(link, function (kind, body) {
        frames.push({kind, id: body.readUInt32BE(0), said: JSON.parse(body.subarray(4).toString('utf8'))});
    });
    const asked = [['laptop', 'photos'], ['vps1', 'aside'], ['vps1', 'nothing']];
    for (let i = 0; i < asked.length; i++) {
        const state = {socket: link, streams: {}};
        mount_join(running.app, {name: asked[i][0], state}, (2*i) + 1, asked[i][1]);
        assert.deepStrictEqual(state.streams, {}, asked[i].join(' '));
    }
    await wait_until(() => frames.length === asked.length);
    assert.deepStrictEqual(frames.map(v => `${v.kind} ${v.id} ${v.said.code}`), ['x 1 EBADTARGET', 'x 3 EBADTARGET', 'x 5 EBADTARGET']);
});

// The row is shown on serviceman's page, where "this machine" reads as serviceman's own: it
// names the machine, and the command that gives it a root half with its whole path
test('a machine with no root half: its row names it and the command that gives it one', async function (t) {
    const base = dir_make(t);
    const running = await serviceman_start(t, [
        {label: 'photos', from: {remote: 'laptop', path: base}, to: {remote: 'vps1', path: '/mnt/photos'}, mode: 'ro'},
    ]);
    agents_start(t, running, base, path.join(base, 'none.sock'));
    await wait_until(() => online(running) && (running.app.remote_by_name.vps1.state.mounts_said !== null));
    const view = (await state_read(running)).mounts[0];
    assert.strictEqual(view.state, 'cannot');
    assert.strictEqual(view.problem, `vps1: no root half to mount with: sudo ${path.join(base, 'agent-vps1', 'bin', 'install-root')}`);
});

// An update restarts the root half, and for the seconds systemd takes to start the new one its
// socket answers nothing. A mount asked then waits for the new one and is mounted: the machine
// has a root half, and is never told it has none.
test('a mount asked while the agent restarts its root half waits for the new one', async function (t) {
    const base = dir_make(t);
    const options = {root_socket: path.join(base, 'root.sock')};
    const was = process.env.SERVICEMAN_AGENT_DIR;
    process.env.SERVICEMAN_AGENT_DIR = path.join(base, 'agent');
    t.after(async function () {
        await agent_mounts_set(options, [], null);
        process.env.SERVICEMAN_AGENT_DIR = was;
    });
    const root = await root_restarting(t, options.root_socket);
    const current = agent_root_current(options, null);
    await wait_until(() => root.away);
    const answer = await agent_mounts_set(options, [{name: 'logs', path: '/mnt/logs', mode: 'ro'}], null);
    assert.strictEqual(answer.root, true);
    assert.deepStrictEqual(answer.items.map(v => `${v.label} ${v.state}`), ['logs mounted']);
    assert.strictEqual(await current, true);
});

function dir_make(t)
{
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-mount-'));
    t.after(function () {
        fs.rmSync(out, {recursive: true, force: true});
    });
    return out;
}

async function serviceman_start(t, mounts, state_dir)
{
    const app = app_from_config(config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'laptop', token: TOKEN_LAPTOP}, {name: 'vps1', token: TOKEN_VPS}],
        mounts,
        services: [],
    }, __dirname));
    if (state_dir !== undefined) {
        app.state_dir = state_dir;
    }
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

// Two machines, each an agent with a folder of its own; vps1's root half is `root_file`
function agents_start(t, running, base, root_file)
{
    const children = [
        agent_start(running.control_port, TOKEN_LAPTOP, path.join(base, 'agent-laptop'), path.join(base, 'no-root.sock')),
        agent_start(running.control_port, TOKEN_VPS, path.join(base, 'agent-vps1'), root_file),
    ];
    t.after(function () {
        for (const child of children) {
            child.kill('SIGKILL');
        }
    });
}

function agent_start(control_port, token, dir, root_file)
{
    fs.mkdirSync(dir, {recursive: true});
    const argv = [AGENT, '--url', `http://127.0.0.1:${control_port}`, '--token', token, '--root-socket', root_file];
    const out = child_process.spawn(process.execPath, argv, {stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: dir})});
    out.stdout.resume();
    out.stderr.resume();
    return out;
}

// A root half that takes every table of mounts it is handed and says each one is mounted, and
// knows nothing else
async function root_fake(t, base)
{
    const out = {file: path.join(base, 'root.sock'), tables: []};
    const server = net.createServer(function (socket) {
        let rest = '';
        socket.on('data', function (chunk) {
            rest += chunk.toString();
            if (rest.includes('\n') === false) {
                return;
            }
            const job = JSON.parse(rest.slice(0, rest.indexOf('\n')));
            if (job.method !== 'mounts') {
                socket.end(`${JSON.stringify({type: 'reply', ok: false, error: `no ${job.method} here`})}\n`);
                return;
            }
            const table = job.params.table;
            out.tables.push(table);
            const items = table.mounts.map(v => ({label: v.label, path: v.path, mode: v.mode, state: 'mounted'}));
            socket.end(`${JSON.stringify({type: 'reply', ok: true, value: {ok: true, items, leaving: []}})}\n`);
        });
    });
    await new Promise(v => server.listen(out.file, v));
    t.after(function () {
        server.close();
    });
    return out;
}

// A root half of an older build under systemd: told to restart, it answers and goes, and the
// new one answers a second and a half later
async function root_restarting(t, file)
{
    const out = {away: false, server: null, done: false};
    await root_restarting_listen(out, file);
    t.after(function () {
        out.done = true;
        out.server.close();
    });
    return out;
}

async function root_restarting_listen(root, file)
{
    if (root.done) {
        return;
    }
    root.server = net.createServer(function (socket) {
        let rest = '';
        socket.on('data', function (chunk) {
            rest += chunk.toString();
            if (rest.includes('\n') === false) {
                return;
            }
            const job = JSON.parse(rest.slice(0, rest.indexOf('\n')));
            socket.end(`${JSON.stringify({type: 'reply', ok: true, value: root_restarting_answer(root, job)})}\n`);
            if (job.method === 'restart') {
                root.server.close();
                fs.rmSync(file, {force: true});
                root.away = true;
                setTimeout(root_restarting_listen, 1500, root, file);
            }
        });
    });
    await new Promise(v => root.server.listen(file, v));
}

function root_restarting_answer(root, job)
{
    if (job.method === 'ping') {
        return {built: root.away ? null : 'older', supervised: true};
    }
    if (job.method === 'restart') {
        return {stopping: true, refreshed: false, reason: 'one file for both halves'};
    }
    return {ok: true, items: job.params.table.mounts.map(v => ({label: v.label, path: v.path, mode: v.mode, state: 'mounted'})), leaving: []};
}

// What sshfs does: runs the agent's --pipe with ssh's own words after the socket, and speaks
// SFTP on its stdin and stdout
async function pipe_open(t, socket)
{
    const child = child_process.spawn(process.execPath, [AGENT, '--pipe', socket, '-x', '-a', '-oClearAllForwardings=yes', 'serviceman', '-s', 'sftp'], {stdio: ['pipe', 'pipe', 'inherit']});
    t.after(function () {
        child.kill('SIGKILL');
    });
    const duplex = new stream.Duplex({
        read: function () {},
        write: function (chunk, encoding, callback) {
            child.stdin.write(chunk, callback);
        },
    });
    child.stdout.on('data', function (chunk) {
        duplex.emit('data', chunk);
    });
    return await sftp_client(duplex);
}

// The socket a session agent listens on for a mount: in its folder, named by the label's sum
function socket_of(base, machine, label)
{
    return path.join(base, `agent-${machine}`, 'mounts', `${crypto.createHash('sha256').update(label).digest('hex').slice(0, 16)}.sock`);
}

function online(running)
{
    return running.app.remotes.every(v => v.state.phase === 'online');
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


// A socket file's path has 107 bytes at most: an agent whose folder is deeper than that keeps
// its mounts' sockets in a folder of its user's alone in the temp folder
test('an agent folder too deep for a socket file puts the sockets in a temp folder of its own', async function (t) {
    const base = dir_make(t);
    const deep = path.join(base, 'a'.repeat(60), 'b'.repeat(40));
    fs.mkdirSync(deep, {recursive: true});
    const was = process.env.SERVICEMAN_AGENT_DIR;
    process.env.SERVICEMAN_AGENT_DIR = deep;
    t.after(async function () {
        await agent_mounts_set({root_socket: path.join(base, 'none.sock')}, [], null);
        process.env.SERVICEMAN_AGENT_DIR = was;
    });
    const answer = await agent_mounts_set({root_socket: path.join(base, 'none.sock')}, [{name: 'deep one', path: '/mnt/deep', mode: 'ro'}], null);
    assert.strictEqual(answer.root, false);
    assert.match(answer.items[0].error, /^no root half to mount with: sudo .*\/bin\/install-root$/);
    const dir = path.join(os.tmpdir(), `serviceman-mounts-${process.getuid()}`);
    const socket = path.join(dir, `${crypto.createHash('sha256').update('deep one').digest('hex').slice(0, 16)}.sock`);
    assert.strictEqual(fs.lstatSync(socket).isSocket(), true);
    assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700);
});
