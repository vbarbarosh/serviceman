const app_from_config = require('../src/main/src/helpers/app_from_config');
const apt_run = require('../src/main/src/helpers/apt_run');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const doors_tell = require('../src/main/src/helpers/doors_tell');
const fetch_host = require('./fetch_host');
const forwards_tell = require('../src/main/src/helpers/forwards_tell');
const fs = require('fs');
const http = require('http');
const link_read = require('../src/helpers/link_read');
const link_send = require('../src/helpers/link_send');
const link_send_message = require('../src/helpers/link_send_message');
const os = require('os');
const path = require('path');
const remote_call = require('../src/main/src/helpers/remote_call');
const remote_said_refusal = require('../src/main/src/helpers/remote_said_refusal');
const server_start = require('../src/main/src/helpers/server_start');
const shared_tell = require('../src/main/src/helpers/shared_tell');
const test = require('node:test');
const timers = require('timers/promises');

const TOKEN = 'cccccccccccccccccccccccccccccccc';

const GB = 1024*1024*1024;
// The least a machine says it is for its hello to be taken, and the least of what moves on it:
// the parts every reader takes as given. An agent says more.
const RESOURCES = {hostname: 'laptop', platform: 'Linux 6.8.0', arch: 'x64', node: 'v24.0.0', cpu: {count: 4, model: 'cpu'}, mem: {total: 8*GB}, disk: {path: '/', total: 100*GB, free: 50*GB}, docker: null};
const STATS = {uptime_ms: 60000, load: 0.5, mem_free: 4*GB, disk_free: 50*GB};
// Resources of another shape, one part at a time: [the part ('' is the whole of them), what
// is said there (undefined: it is left out), the part the log names where that is another]
const RESOURCES_ODD = [
    ['', {}, 'hostname'],
    ['', undefined],
    ['', null],
    ['', 'laptop'],
    ['', 5],
    ['', [1]],
    ['hostname', undefined],
    ['hostname', {}],
    ['user', 0],
    ['os', []],
    ['platform', undefined],
    ['arch', 64],
    ['node', null],
    ['cpu', undefined],
    ['cpu', 4],
    ['cpu.count', '4'],
    ['cpu.model', undefined],
    ['mem', undefined],
    ['mem', {}, 'mem.total'],
    ['mem.total', null],
    ['mem.total', '8GB'],
    ['disk', undefined],
    ['disk', '/'],
    ['disk.path', undefined],
    ['disk.total', undefined],
    ['disk.free', 'much'],
    ['docker', undefined],
    ['docker', 28],
    ['docker_socket', {}],
    ['can', {}],
    ['can', 'apt'],
    ['can', ['apt', 1]],
    ['dir', 5],
    ['services', []],
    ['addresses', '192.0.2.1'],
    ['addresses', [null]],
    ['logline', 'all'],
    ['logline', {floor: 5}, 'logline.floor'],
    ['doors', 'none'],
    ['doors', {version: 5}, 'doors.version'],
    ['doors', {peer: '192.0.2.1'}, 'doors.peer'],
    ['doors', {peer: {addresses: '192.0.2.1', port: 1}}, 'doors.peer.addresses'],
    ['doors', {peer: {addresses: [], port: '1'}}, 'doors.peer.port'],
];
// Stats of another shape, the same way
const STATS_ODD = [
    ['', undefined],
    ['', null],
    ['', 'busy'],
    ['', 5],
    ['', [1]],
    ['', {}, 'uptime_ms'],
    ['can', 'apt'],
    ['can', [5]],
    ['uptime_ms', undefined],
    ['uptime_ms', null],
    ['uptime_ms', '1h'],
    ['load', undefined],
    ['load', [0, 0, 0]],
    ['load', 'high'],
    ['mem_free', undefined],
    ['mem_free', {}],
    ['disk_free', undefined],
    ['disk_free', true],
    ['cpu_busy', '10%'],
    ['disks', 3],
    ['disks', {count: 1, total: 'all', used: 1}, 'disks.total'],
    ['battery', 'full'],
    ['battery', {percent: '80', status: 'full'}, 'battery.percent'],
    ['battery', {percent: 80}, 'battery.status'],
    ['temperature', 40],
    ['temperature', {c: 40}, 'temperature.of'],
    ['servermon', 'running'],
    ['servermon', {state: 'silent'}, 'servermon.last_at'],
    ['servermon', {state: 'silent', last_at: 5}, 'servermon.last_at'],
    ['uptime_30d', {known_ms: 1}, 'uptime_30d.down_ms'],
    ['door', '0660'],
    ['door', {path: '/home/user/serviceman-agent/http.sock'}, 'door.mode'],
    ['updates', 3],
    ['updates', {pending: '3', security: 0, reboot: false}, 'updates.pending'],
    ['updates', {pending: 3, security: 0, held: 'two', reboot: false}, 'updates.held'],
    ['updates', {pending: 3, security: 0, reboot: 'yes'}, 'updates.reboot'],
    ['updates', {pending: 3, security: 0, reboot: false, lists_at: 'today'}, 'updates.lists_at'],
    ['logline', true],
    ['logline', {collecting: true}, 'logline.containers'],
    ['logline', {collecting: true, containers: 1, sent: {lines: null, batches: 0, bytes: 0}}, 'logline.sent.lines'],
    ['logline', {collecting: true, containers: 1, dir_errors: {'/var/log/app': 13}, sent: {lines: 0, batches: 0, bytes: 0}}, 'logline.dir_errors.*'],
    ['logline', {collecting: true, containers: 1, sent: {lines: 0, batches: 0, bytes: 0}, waiting: {lines: 0, bytes: 0, oldest: 5}}, 'logline.waiting.oldest'],
    ['logline', {collecting: true, containers: 1, sent: {lines: 0, batches: 0, bytes: 0}, waiting: {lines: 0, bytes: 0, oldest: null}, last_sent_at: null, last_answer: 404}, 'logline.last_answer'],
    ['logline', {collecting: true, containers: 1, sent: {lines: 0, batches: 0, bytes: 0}, waiting: {lines: 0, bytes: 0, oldest: null}, last_sent_at: null, last_answer: null, aside: {files: '3', bytes: 0, full: false}}, 'logline.aside.files'],
    ['logline', {collecting: true, containers: 1, sent: {lines: 0, batches: 0, bytes: 0}, waiting: {lines: 0, bytes: 0, oldest: null}, last_sent_at: null, last_answer: null, aside: {files: 3, bytes: 0}}, 'logline.aside.full'],
    ['doors_seen', 'site'],
    ['doors_seen', {site: 'now'}, 'doors_seen.*'],
];

// A machine is told its forwards, its doors and its shared folders at its hello and on the
// minute, by calls nobody waits for. What they read is what the machine said of itself, and a
// machine says what it will: read wrongly there, one frame ended serviceman.
test('a hello whose `can` is no list stops no telling', async function () {
    const app = app_made();
    const remote = app.remote_by_name.laptop;
    remote.state.phase = 'online';
    for (const can of [{}, 'forwards', 5, null]) {
        remote.state.resources = {can};
        await forwards_tell(app);
        await doors_tell(app);
        await shared_tell(app);
    }
    assert.strictEqual(remote.state.forwards_told, null, 'a machine that names no list is told nothing');
});

test('a kept answer of another shape is a line in the log, not the end of the process', async function () {
    const app = app_made();
    const remote = app.remote_by_name.laptop;
    remote.state.phase = 'online';
    remote.state.resources = {can: ['forwards']};
    // What a machine once answered forwards_set with, kept as it came
    remote.state.forwards_said = {x: null};
    await forwards_tell(app);
    assert.strictEqual(app.log_lines.some(v => /\[forwards_tell_error\] reason=/.test(v)), true);
});

test('a kept table of shared folders that does not read is a line in the log, not the end of the process', async function () {
    const app = app_made();
    fs.writeFileSync(path.join(app.state_dir, 'shared_folders.json'), '{"mounts": [');
    await shared_tell(app);
    assert.strictEqual(app.log_lines.some(v => /\[shared_tell_error\] reason=/.test(v)), true);
});

// What a machine says of itself is kept, and the status reads it for as long as serviceman runs.
// Kept as it came, a hello with resources {} left GET /api/v1/status answering 500, for every
// machine and with that one long gone.
test('a hello of another shape is refused, and the status goes on answering', async function (t) {
    const running = await serviceman_start(t);
    const remote = running.app.remote_by_name.laptop;
    for (const [where, value, named] of RESOURCES_ODD) {
        const title = `a hello whose ${(where === '') ? 'resources are' : `${where} is`} ${JSON.stringify(value)}`;
        const machine = await machine_dial(running);
        link_send_message(machine, {type: 'hello', agent: '1.33.7', resources: said_with(RESOURCES, where, value), stats: STATS});
        await wait_until(() => machine.destroyed && (remote.state.socket === null));
        const view = (await status_read(running, title)).remotes[0];
        assert.deepStrictEqual([view.phase, view.agent_version, view.machine, view.doors], ['offline', null, null, null], `${title}: its machine is shown as one that has said nothing`);
        assert.deepStrictEqual([remote.state.resources, remote.state.stats], [null, null], `${title}: nothing of it is kept`);
        assert.strictEqual(link_errors(running).pop(), `remote=laptop reason=hello_shape part=${part_named('resources', where, named)} then="refused, and its link closed"`, title);
    }
    // A thousand of them at once are one line, not a thousand
    const before = link_errors(running).length;
    const flood = await machine_dial(running);
    flood.cork();
    for (let i = 0; i < 1000; ++i) {
        link_send_message(flood, {type: 'hello', agent: '1.33.7', resources: {}});
    }
    flood.uncork();
    await wait_until(() => flood.destroyed && (remote.state.socket === null));
    assert.strictEqual(link_errors(running).length, before + 1);
    // An honest hello is taken as it always was. An odd one after it is refused the same, and
    // its machine, away now, is shown with what it last said.
    const machine = await machine_dial(running);
    link_send_message(machine, {type: 'hello', agent: '1.33.7', resources: RESOURCES, stats: STATS});
    await wait_until(() => remote.state.phase === 'online');
    const online = (await status_read(running, 'an honest hello')).remotes[0];
    assert.deepStrictEqual([online.machine.hostname, online.machine.mem, online.machine.uptime_ms], ['laptop', {total: 8*GB, free: 4*GB}, 60000]);
    link_send_message(machine, {type: 'hello', agent: '1.33.7', resources: said_with(RESOURCES, 'mem', {})});
    await wait_until(() => machine.destroyed && (remote.state.socket === null));
    const away = (await status_read(running, 'an odd hello after an honest one')).remotes[0];
    assert.deepStrictEqual([away.phase, away.machine], ['offline', online.machine]);
});

test('stats of another shape are left out and said once a link, and the status goes on answering', async function (t) {
    const running = await serviceman_start(t);
    const remote = running.app.remote_by_name.laptop;
    // A hello with no stats in it: the machine is online, and none of its numbers is known
    const machine = await machine_dial(running);
    link_send_message(machine, {type: 'hello', agent: '1.33.7', resources: RESOURCES});
    await wait_until(() => remote.state.phase === 'online');
    const bare = (await status_read(running, 'a hello with no stats')).remotes[0].machine;
    assert.deepStrictEqual([bare.hostname, bare.mem, bare.disk.free, bare.load, bare.uptime_ms, bare.updates, bare.door], ['laptop', {total: 8*GB, free: null}, 50*GB, null, null, null, null]);
    for (const [where, value, named] of STATS_ODD) {
        const title = `stats whose ${(where === '') ? 'whole' : where} is ${JSON.stringify(value)}`;
        const said = said_with(STATS, where, value);
        assert.strictEqual(remote_said_refusal('stats', said), part_named('stats', where, named), title);
        // Good ones are kept again after odd ones, and the next odd ones take them away
        link_send_message(machine, {type: 'stats', stats: STATS});
        await wait_until(() => remote.state.stats !== null);
        link_send_message(machine, {type: 'stats', stats: said});
        await wait_until(() => remote.state.stats === null);
        const view = (await status_read(running, title)).remotes[0];
        assert.strictEqual(view.phase, 'online', `${title}: its link stays`);
        assert.deepStrictEqual(view.machine, bare, `${title}: its machine is shown as one that has said no stats yet`);
    }
    // 1e999 is JSON too, and no number a page can show
    link_send_message(machine, {type: 'stats', stats: STATS});
    await wait_until(() => remote.state.stats !== null);
    link_send(machine, 'm', Buffer.from(JSON.stringify({type: 'stats', stats: STATS}).replace('60000', '1e999')));
    await wait_until(() => remote.state.stats === null);
    // They come every few seconds: a thousand more are no line more, and the link says it once
    for (let i = 0; i < 1000; ++i) {
        link_send_message(machine, {type: 'stats', stats: said_with(STATS, 'uptime_ms', `${i}h`)});
    }
    link_send_message(machine, {type: 'stats', stats: Object.assign({}, STATS, {can: ['apt']})});
    await wait_until(() => remote.state.stats !== null);
    assert.deepStrictEqual(link_errors(running), ['remote=laptop reason=stats_shape part=stats then="left out, and said once for this link"']);
    const view = (await status_read(running, 'good stats after odd ones')).remotes[0];
    assert.deepStrictEqual([view.machine.mem.free, view.machine.load, view.machine.uptime_ms, view.machine.can], [4*GB, 0.5, 60000, ['apt']], 'good stats are kept again');
});

// An upgrade asks the machine its stats once more at its end, and kept that answer as it came
test('the stats an upgrade asks for at its end are kept as a heartbeat\'s are: of that shape, or not at all', async function (t) {
    const running = await serviceman_start(t);
    const remote = running.app.remote_by_name.laptop;
    // It answers `stats` with no value at all and refuses the rest, so the upgrade ends at once
    const machine = await machine_dial(running, v => (v === 'stats') ? {ok: true} : {ok: false, error: `no ${v} here`});
    link_send_message(machine, {type: 'hello', agent: '1.33.7', resources: RESOURCES, stats: STATS});
    await wait_until(() => remote.state.phase === 'online');
    await apt_run(running.app, remote);
    // Answers come in the order they were asked for: once this one is here, that one was read
    await assert.rejects(remote_call(running.app, remote, 'last'), /no last here/);
    assert.strictEqual((await status_read(running, 'an upgrade')).remotes[0].machine.mem.free, 4*GB);
    assert.deepStrictEqual(remote.state.stats, STATS, 'the stats it said before stay');
});

// The same serviceman with its doors open, on ports of its own, for a machine to dial and its
// status to be asked. `lines` is every line it writes, taken from stdout: its own list keeps
// the last 300.
async function serviceman_start(t)
{
    const app = app_made({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}});
    const lines = [];
    const log = console.log;
    console.log = function (line) {
        lines.push(line);
    };
    const servers = await server_start(app);
    t.after(function () {
        console.log = log;
        if (app.remote_by_name.laptop.state.socket !== null) {
            app.remote_by_name.laptop.state.socket.destroy();
        }
        for (const door of [servers.server, servers.control]) {
            door.close();
            door.closeAllConnections();
        }
    });
    return {app, lines, control_port: servers.control.address().port};
}

// The machine played by hand: it dials in with its token, to say on its link exactly what a
// test wants said. What it is asked it refuses, unless `answer` says otherwise: given the
// method, it answers the reply's {ok, value} or {ok, error}. Answers its end of the link.
function machine_dial(running, answer)
{
    return new Promise(function (resolve, reject) {
        const request = http.request({host: '127.0.0.1', port: running.control_port, agent: false, path: '/api/v1/remote', headers: {connection: 'Upgrade', upgrade: 'serviceman', authorization: `Bearer ${TOKEN}`}});
        request.on('upgrade', function (upgraded, socket) {
            link_read(socket, function (kind, body) {
                const message = (kind === 'm') ? JSON.parse(body.toString('utf8')) : {};
                if (message.type === 'call') {
                    link_send_message(socket, Object.assign({type: 'reply', id: message.id}, (answer === undefined) ? {ok: false, error: `no ${message.method} here`} : answer(message.method)));
                }
            });
            socket.on('error', function () {
                // Its close says the rest
            });
            resolve(socket);
        });
        request.on('error', reject);
        request.end();
    });
}

// A copy of what a machine says, with one part of it said otherwise: `where` is the part's path
// in it, '' the whole of it; a part that is undefined is left out
function said_with(said, where, value)
{
    if (where === '') {
        return value;
    }
    const out = structuredClone(said);
    const names = where.split('.');
    let part = out;
    for (const name of names.slice(0, -1)) {
        part = part[name];
    }
    part[names[names.length - 1]] = value;
    return out;
}

// The part the log names for a row of RESOURCES_ODD or STATS_ODD: `resources.mem.total`
function part_named(what, where, named)
{
    return [what, (named === undefined) ? where : named].filter(v => v !== '').join('.');
}

// The words of every line that says a link misbehaved, oldest first
function link_errors(running)
{
    return running.lines.filter(v => v.includes('[remote_link_error] ')).map(v => v.replace(/^.*\[remote_link_error\] /, ''));
}

// The status as the control page reads it, after something a machine said. Where serviceman
// broke on it, the test fails on what serviceman's log says of that.
async function status_read(running, after)
{
    const answer = await fetch_host({port: running.control_port, host: '127.0.0.1', path: '/api/v1/status'});
    const broke = running.lines.filter(v => v.includes('[serviceman_error] ')).map(v => v.replace(/^.*\[serviceman_error\] /, ''));
    assert.strictEqual(answer.status, 200, `GET /api/v1/status after ${after}: ${broke.pop()}`);
    return JSON.parse(answer.body);
}

async function wait_until(ready)
{
    const deadline = Date.now() + 10000;
    while (ready() === false) {
        if (Date.now() >= deadline) {
            throw new Error('the condition never came true');
        }
        await timers.setTimeout(5);
    }
}

// A serviceman that listens nowhere, with one machine and a state folder of its own; `doors`
// are the config's listen and control, for one that listens
function app_made(doors)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-tellings-'));
    test.after(function () {
        fs.rmSync(dir, {recursive: true, force: true});
    });
    const app = app_from_config(config_from_json(Object.assign({services: [], remotes: [{name: 'laptop', token: TOKEN}]}, doors), dir));
    app.state_dir = dir;
    return app;
}
