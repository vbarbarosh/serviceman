const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const machine_light = require('../src/main/src/helpers/machine_light');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');

const TOKEN = '0123456789abcdef0123456789abcdef';

// A Health page with one machine's row and the rows of two services
function health_of(machine_checks, services)
{
    const rows = [];
    for (const name of Object.keys(services)) {
        rows.push({key: `service:${name}`, state: worst(services[name]), checks: services[name]});
    }
    return {areas: [
        {key: 'machines', rows: [{key: 'remote:vps1', state: worst(machine_checks), checks: machine_checks}]},
        {key: 'services', rows},
    ]};
}

// A row is as well as its worst check
function worst(checks)
{
    const states = checks.map(v => v.state);
    return ['bad', 'warn', 'ok'].find(v => states.includes(v)) || 'none';
}

function service(name, instances, extra)
{
    return Object.assign({name, title: name, remotes: ['vps1'], doing: null, instances}, extra);
}

const ONLINE = {name: 'vps1', phase: 'online'};
const IDLE = {apt: false, docker: false, mend: false};

// The light: dark away, red for what does not work, amber for what to look at, green else; a
// service counts on the machine its copy runs on, or where it may run while none has started
test('a machine\'s light: dark away, red when something there does not work, amber to look, green else', function () {
    const ok = [{key: 'link', label: 'Link', state: 'ok', text: 'online'}];
    assert.deepStrictEqual(machine_light({name: 'vps1', phase: 'offline'}, health_of(ok, {}), [], IDLE), {light: 'dark', work: false, said: ['away: its agent is not connected']});
    assert.deepStrictEqual(machine_light(ONLINE, health_of(ok, {}), [], IDLE), {light: 'green', work: false, said: []});

    const look = ok.concat([{key: 'updates', label: 'Updates', state: 'warn', text: '3 security'}]);
    assert.deepStrictEqual(machine_light(ONLINE, health_of(look, {}), [], IDLE), {light: 'amber', work: false, said: ['Updates: 3 security']});

    // A service of it failed: red, and why, the worse first
    const failed = health_of(look, {mail: [{key: 'phase', label: 'State', state: 'bad', text: 'failed 3 times'}]});
    const mail = service('mail', [{slot: 0, remote: 'vps1', phase: 'failed'}]);
    assert.deepStrictEqual(machine_light(ONLINE, failed, [mail], IDLE), {light: 'red', work: false, said: ['mail: failed 3 times', 'Updates: 3 security']});

    // The same service placed on another machine is that machine's, not this one's
    const elsewhere = service('mail', [{slot: 0, remote: 'vps2', phase: 'failed'}]);
    assert.strictEqual(machine_light(ONLINE, failed, [elsewhere], IDLE).light, 'amber');
});

// Work turns the ring whatever the colour: a copy starting there, a service pulling, apt, a
// Docker long action, a mend; a machine away has none
test('work going on a machine: a copy starting there, a pull, apt, a Docker long action, a mend', function () {
    const ok = health_of([{key: 'link', label: 'Link', state: 'ok', text: 'online'}], {});
    assert.strictEqual(machine_light(ONLINE, ok, [service('blog', [{slot: 0, remote: 'vps1', phase: 'starting'}])], IDLE).work, true);
    assert.strictEqual(machine_light(ONLINE, ok, [service('blog', [{slot: 0, remote: 'vps2', phase: 'starting'}])], IDLE).work, false);
    assert.strictEqual(machine_light(ONLINE, ok, [service('blog', [], {doing: 'pulling'})], IDLE).work, true);
    for (const key of ['apt', 'docker', 'mend']) {
        assert.strictEqual(machine_light(ONLINE, ok, [], Object.assign({}, IDLE, {[key]: true})).work, true, key);
    }
    assert.strictEqual(machine_light({name: 'vps1', phase: 'offline'}, ok, [], Object.assign({}, IDLE, {apt: true})).work, false);
});

// Where a machine stands and how it is drawn are kept in the state folder and come back in the
// status; what is not a place or a kind, and a machine the config has not, are refused
test('a machine put somewhere on the Canvas, and drawn as a laptop, stays so; nonsense is refused', async function (t) {
    const config = config_from_json({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, remotes: [{name: 'vps1', token: TOKEN}, {name: 'vps2', token: TOKEN.replace('0', '1')}], services: []}, __dirname);
    const app = app_from_config(config);
    app.state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-canvas-'));
    t.after(() => fs.rmSync(app.state_dir, {recursive: true, force: true}));
    const servers = await server_start(app);
    t.after(function () {
        for (const door of [servers.server, servers.control, servers.socket]) {
            if ((door !== undefined) && (door !== null)) {
                door.close();
            }
        }
    });
    const port = servers.control.address().port;

    assert.deepStrictEqual((await call(port, 'PUT', '/api/v1/canvas/machines/vps1', {x: 120.4, y: -40})).body, {machine: {name: 'vps1', x: 120, y: -40}});
    assert.deepStrictEqual((await call(port, 'PUT', '/api/v1/canvas/machines/vps1', {kind: 'laptop'})).body, {machine: {name: 'vps1', x: 120, y: -40, kind: 'laptop'}});
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(app.state_dir, 'canvas.json'), 'utf8')), {machines: {vps1: {x: 120, y: -40, kind: 'laptop'}}});

    const refused = [
        await call(port, 'PUT', '/api/v1/canvas/machines/vps1', {kind: 'toaster'}),
        await call(port, 'PUT', '/api/v1/canvas/machines/vps1', {x: 'left', y: 0}),
        await call(port, 'PUT', '/api/v1/canvas/machines/vps1', {x: 1e9, y: 0}),
        await call(port, 'PUT', '/api/v1/canvas/machines/ghost', {x: 0, y: 0}),
    ];
    assert.deepStrictEqual(refused.map(v => [v.status, v.body.error]), [
        [400, 'kind is one of server, laptop, home'],
        [400, 'x and y are numbers within 100000 of the middle'],
        [400, 'x and y are numbers within 100000 of the middle'],
        [404, 'no remote named "ghost"'],
    ]);

    // The status says every machine of the config: where it was put, or nowhere yet, a server
    const canvas = (await call(port, 'GET', '/api/v1/status')).body.canvas;
    assert.deepStrictEqual(canvas.machines.map(v => [v.name, v.kind, v.x, v.y, v.light, v.work]), [
        ['vps1', 'laptop', 120, -40, 'dark', false],
        ['vps2', 'server', null, null, 'dark', false],
    ]);
});

async function call(port, method, pathname, body)
{
    const answer = await fetch_host({port, host: '127.0.0.1', path: pathname, method, body: (body === undefined) ? undefined : JSON.stringify(body), headers: (body === undefined) ? {} : {'content-type': 'application/json'}});
    return {status: answer.status, body: JSON.parse(answer.body)};
}
