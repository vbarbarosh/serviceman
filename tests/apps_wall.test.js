const app_from_config = require('../src/main/src/helpers/app_from_config');
const app_ports_here = require('../src/main/src/helpers/app_ports_here');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const door_inbound = require('../src/main/src/helpers/door_inbound');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const service_rename_ties = require('../src/main/src/helpers/service_rename_ties');
const tailnet_name_read = require('../src/main/src/helpers/tailnet_name_read');
const test = require('node:test');
const view_from_service = require('../src/main/src/helpers/view_from_service');

const TAILNET = {name: 'serviceman.tail1234.ts.net', ip: '100.64.0.20'};

// The wall Apps names is a service of the config; every app with no wall of its own takes it, a
// service that is no app does not, the wall itself is never behind itself, and an app's own
// wall stays its own. The view says which is which, so an app's own box is never written with
// the wall Apps gave it.
test('apps.auth puts every app with no wall of its own behind it, and nothing else', function () {
    const config = config_from_json({apps: {auth: 'authwall'}, services: [
        {name: 'authwall', type: 'files', publish: {host: 'authwall.test'}},
        {name: 'notes', type: 'files', publish: {host: 'notes.test'}},
        {name: 'board', type: 'files', publish: {host: 'board.test'}, auth: 'gate'},
        {name: 'gate', type: 'external', publish: {host: 'gate.test'}, upstream: '127.0.0.1:9'},
        {name: 'proxy', type: 'external', publish: {host: 'proxy.test'}, upstream: '127.0.0.1:9'},
    ]}, '/srv/serviceman');
    const by = Object.fromEntries(config.services.map(v => [v.name, v]));
    assert.strictEqual(config.apps.auth, 'authwall');
    assert.deepStrictEqual([by.notes.auth, by.notes.auth_from], ['authwall', 'apps'], 'an app takes it');
    assert.deepStrictEqual([by.board.auth, by.board.auth_from], ['gate', undefined], 'an app\'s own wall stays');
    assert.strictEqual(by.proxy.auth, null, 'a service that is no app does not');
    assert.strictEqual(by.authwall.auth, null, 'the wall, an app of files though it is, is not behind itself');
    const app = app_from_config(config);
    assert.strictEqual(view_from_service(app.service_by_name.notes, 0).auth_from, 'apps');
    assert.strictEqual(view_from_service(app.service_by_name.board, 0).auth_from, null);

    assert.strictEqual(config_from_json({apps: {}, services: []}, '/srv').apps.auth, null, 'none said is none');
    assert.strictEqual(config_from_json({apps: {auth: ''}, services: []}, '/srv').apps.auth, null, 'an empty one is none');
    assert.throws(() => config_from_json({apps: {auth: 'gate'}, services: []}, '/srv'), /apps\.auth: every app is behind "gate", and no service has that name/);
    assert.throws(() => config_from_json({apps: {auth: 7}, services: []}, '/srv'), /apps\.auth: the name of the service/);

    const json = {apps: {auth: 'authwall'}, services: [{name: 'authwall'}], remotes: []};
    service_rename_ties(null, json, 'authwall', 'wall');
    assert.strictEqual(json.apps.auth, 'wall', 'a rename of the wall carries Apps\' wall with it');
});

// On serviceman's own door: the page of apps asks the wall first, at apps.localhost and at
// serviceman's tailnet name, its sign-in the wall's on the name typed; an app asks it at its name
// and at its own port; a service that is no app is not asked for; signed in, all of it answers
test('the page of apps and every app ask the wall Apps names, on each name and port', async function (t) {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-tailscale-'));
    fs.writeFileSync(path.join(bin, 'tailscale'), `#!/bin/sh
if [ "$1" = "ip" ]; then echo ${TAILNET.ip}; else echo '{"Self": {"DNSName": "${TAILNET.name}."}}'; fi
`, {mode: 0o755});
    const path_before = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${path_before}`;
    t.after(function () {
        process.env.PATH = path_before;
        fs.rmSync(bin, {recursive: true, force: true});
    });
    assert.strictEqual(await tailnet_name_read(), TAILNET.name);
    const wall = await wall_make(t);
    const echo = await server_of(t, (req, res) => res.end(`echo for ${req.headers['x-auth-user'] || 'nobody'}`));
    const state = state_make(t, ['notes']);
    const app = app_from_config(config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        apps: {ports: 0, auth: 'authwall'},
        services: [
            {name: 'authwall', type: 'external', publish: {host: 'authwall.localhost'}, upstream: `127.0.0.1:${wall.server.address().port}`},
            {name: 'notes', type: 'files', publish: {host: 'notes.localhost'}},
            {name: 'echo', type: 'external', publish: {host: 'echo.localhost'}, upstream: `127.0.0.1:${echo.address().port}`},
        ],
    }, state));
    const port = await boot(t, app);
    const own_port = app.app_ports_here.notes.port;

    for (const host of [`apps.localhost:${port}`, `${TAILNET.name}:${port}`]) {
        const refused = await fetch_host({port, host, path: '/', token: null});
        assert.deepStrictEqual([refused.status, refused.headers.location], [302, '/auth/sign-in?return=%2F'], `${host}: sent to sign in`);
        const sign_in = await fetch_host({port, host, path: '/auth/sign-in?return=%2F', token: null});
        assert.deepStrictEqual([sign_in.status, sign_in.body], [200, 'the wall\'s own page /auth/sign-in?return=%2F'], `${host}: the wall's sign-in on the page's name`);
        const page = await fetch_host({port, host, path: '/', token: null, headers: {cookie: 'session=good'}});
        assert.strictEqual(page.status, 200, host);
        assert.match(page.body, /1 app/, `${host}: signed in, the page`);
        assert.strictEqual((await fetch_host({port, host, path: '/more', token: null})).status, 302, `${host}: nothing of it before the wall`);
    }
    for (const [at, host] of [[port, 'notes.localhost'], [own_port, `${TAILNET.name}:${own_port}`]]) {
        assert.strictEqual((await fetch_host({port: at, host, path: '/', token: null})).status, 302, `${host}: the app asks it`);
        assert.strictEqual((await fetch_host({port: at, host, path: '/', token: null, headers: {cookie: 'session=good'}})).body, '<title>notes</title>', `${host}: signed in, the app`);
    }
    assert.strictEqual((await fetch_host({port, host: 'echo.localhost', path: '/', token: null})).body, 'echo for nobody', 'a service that is no app is not behind it');
    assert.deepStrictEqual(['apps.localhost', TAILNET.name, 'notes.localhost'].map(v => wall.asked.includes(v)), [true, true, true], 'the wall was asked for the page and the app');
    assert.strictEqual(wall.asked.includes('echo.localhost'), false, 'and not for it');
});

// Through a machine's door, the apps domain's page is behind the rule's wall where it names one,
// and behind Apps' wall where it does not; its /auth is that wall's
test('the apps domain through a door: the rule\'s wall, else the one Apps names', function () {
    const config = config_from_json({
        apps: {domain: 'apps.example.com', auth: 'authwall'},
        remotes: [
            {name: 'vps1', token: 'a'.repeat(32), inbound: {'apps.example.com': {service: '*'}}},
            {name: 'vps2', token: 'b'.repeat(32), inbound: {'apps.example.com': {service: '*', auth: 'gate'}}},
        ],
        services: [
            {name: 'authwall', type: 'external', remote: 'vps1', publish: {host: 'authwall.internal'}, upstream: '127.0.0.1:9'},
            {name: 'gate', type: 'external', remote: 'vps1', publish: {host: 'gate.internal'}, upstream: '127.0.0.1:9'},
        ],
    }, '/srv/serviceman');
    const app = app_from_config(config);
    function door(machine, pathname) {
        const said = door_inbound(app, {headers: {}, socket: {tunnel_from: machine}}, 'apps.example.com', pathname);
        return {home: said.home, wall: (said.wall === null) ? null : said.wall.name, service: (said.route === null) ? null : said.route.service.name};
    }
    assert.deepStrictEqual(door('vps1', '/'), {home: true, wall: 'authwall', service: null});
    assert.deepStrictEqual(door('vps1', '/auth/sign-in'), {home: false, wall: null, service: 'authwall'}, 'its sign-in is the wall\'s');
    assert.deepStrictEqual(door('vps2', '/'), {home: true, wall: 'gate', service: null}, 'a rule that names a wall keeps it');
});

// The box on top of Apps: saved into the config, put to work at once, and taken off the same way
test('PUT /api/v1/apps puts the page and every app behind the wall, and takes them out', async function (t) {
    const wall = await wall_make(t);
    const state = state_make(t, ['notes']);
    const file = path.join(state, 'serviceman.json');
    const first = {
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        apps: {ports: null},
        services: [
            {name: 'authwall', type: 'external', publish: {host: 'authwall.localhost'}, upstream: `127.0.0.1:${wall.server.address().port}`},
            {name: 'notes', type: 'files', publish: {host: 'notes.localhost'}},
        ],
    };
    fs.writeFileSync(file, `${JSON.stringify(first, null, 4)}\n`);
    const config = config_from_json(first, state);
    config.path = file;
    const app = app_from_config(config);
    const port = await boot(t, app);
    function put(body) {
        return fetch_host({port, host: 'serviceman.localhost', method: 'PUT', path: '/api/v1/apps', body: JSON.stringify(body)});
    }
    assert.strictEqual((await fetch_host({port, host: 'apps.localhost', token: null})).status, 200, 'open before');

    const on = await put({auth: 'authwall'});
    assert.strictEqual(on.status, 200, on.body);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).apps, {ports: null, auth: 'authwall'});
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).services[1].auth, undefined, 'the app\'s own entry is not written');
    assert.strictEqual((await fetch_host({port, host: 'apps.localhost', token: null})).status, 302, 'the page, at once');
    assert.strictEqual((await fetch_host({port, host: 'notes.localhost', token: null})).status, 302, 'the app, at once');

    const off = await put({auth: null});
    assert.strictEqual(off.status, 200, off.body);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).apps, {ports: null});
    assert.strictEqual((await fetch_host({port, host: 'apps.localhost', token: null})).status, 200, 'the page open again');
    assert.strictEqual((await fetch_host({port, host: 'notes.localhost', token: null})).body, '<title>notes</title>', 'the app as its own box says');

    assert.strictEqual((await put({auth: 'gate'})).status, 400, 'a wall nobody has');
    assert.strictEqual((await put({})).status, 400, 'no word at all');
    assert.strictEqual((await put({auth: ''})).status, 400, 'an empty name');
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).apps.auth, undefined, 'a refusal writes nothing');
    assert.strictEqual((await fetch_host({port, host: 'serviceman.localhost', method: 'PUT', path: '/api/v1/apps', body: JSON.stringify({auth: 'authwall'}), token: null})).status, 401, 'the owner\'s alone');
});

// A wall for another team, made on the Authwall page: a copy of authwall in the config, its own
// address and first user, the first wall as it was; what cannot be a copy is refused, unwritten
test('POST /api/v1/walls makes a wall for another team, and refuses what cannot be one', async function (t) {
    const state = state_make(t, []);
    const file = path.join(state, 'serviceman.json');
    const wall = {name: 'authwall', type: 'docker', image: 'vbarbarosh/authwall:latest', remotes: ['laptop'], publish: {host: 'authwall.localhost', port: 3000}, env: {AUTHWALL_SEED: 'demo:demo-pass-1234:user@example.com'}, volumes: [{source: '', target: '/app/data'}]};
    const first = {
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        apps: {ports: null},
        remotes: [{name: 'laptop', token: 'cccccccccccccccccccccccccccccccc'}],
        services: [wall, {name: 'gate', type: 'external', publish: {host: 'gate.localhost'}, upstream: '127.0.0.1:9'}],
    };
    fs.writeFileSync(file, `${JSON.stringify(first, null, 4)}\n`);
    const config = config_from_json(first, state);
    config.path = file;
    const app = app_from_config(config);
    const port = await boot(t, app);
    function post(from, body, token) {
        return fetch_host({port, host: 'serviceman.localhost', method: 'POST', path: '/api/v1/walls', body: JSON.stringify(Object.assign({from}, body)), token});
    }
    const user = {username: 'ann', password: 'a-long-password', email: 'ann@example.com'};

    const made = await post('authwall', {name: 'authwall-team-a', title: 'team A', user});
    assert.strictEqual(made.status, 200, made.body);
    const services = JSON.parse(fs.readFileSync(file, 'utf8')).services;
    assert.deepStrictEqual(services[0], wall, 'the first wall is left as it was');
    assert.deepStrictEqual(services[2].publish, {host: 'authwall-team-a.localhost', port: 3000});
    assert.strictEqual(services[2].title, 'team A');
    assert.deepStrictEqual(JSON.parse(services[2].env.AUTHWALL_SEED), [{username: 'ann', emails: 'ann@example.com', password: 'a-long-password'}]);
    assert.deepStrictEqual(app.service_by_name['authwall-team-a'].volumes.map(v => v.keep), ['authwall-team-a/app-data'], 'running with storage of its own');

    assert.strictEqual((await post('authwall', {name: 'authwall-team-a', title: '', user: null})).status, 409, 'a name that is taken');
    assert.strictEqual((await post('nobody', {name: 'authwall-team-b', title: '', user: null})).status, 404, 'a wall that is not there');
    assert.strictEqual((await post('gate', {name: 'authwall-team-b', title: '', user: null})).status, 400, 'a wall serviceman does not run');
    assert.strictEqual((await post('authwall', {name: 'authwall-team-b', title: '', user: {username: 'bob', password: '', email: ''}})).status, 400, 'a first user with no password');
    assert.strictEqual((await post('authwall', {name: 'Team B', title: '', user: null})).status, 400, 'a name a service cannot have');
    assert.strictEqual((await post('authwall', {name: 'authwall-team-b', title: '', user: null}, null)).status, 401, 'the owner\'s alone');
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).services.length, 3, 'a refusal writes nothing');
});

// A wall that lets in the cookie session=good, its own pages answered under /auth; it notes the
// name each question was asked for
async function wall_make(t)
{
    const asked = [];
    const server = await server_of(t, function (req, res) {
        if (req.url === '/auth/sidecar') {
            asked.push(String(req.headers.host).split(':')[0]);
            const good = (req.headers.cookie === 'session=good');
            res.writeHead(good ? 200 : 401, good ? {'x-auth-user': 'user@example.com'} : {});
            res.end();
            return;
        }
        res.end(`the wall's own page ${req.url}`);
    });
    return {server, asked};
}

function server_of(t, handler)
{
    return new Promise(function (resolve) {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', function () {
            t.after(function () {
                server.close();
                server.closeAllConnections();
            });
            resolve(server);
        });
    });
}

// A state folder of its own with an app of files for each name
function state_make(t, names)
{
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-apps-wall-'));
    for (const name of names) {
        fs.mkdirSync(path.join(state, 'apps', name), {recursive: true});
        fs.writeFileSync(path.join(state, 'apps', name, 'index.html'), `<title>${name}</title>`);
    }
    const before = process.env.SERVICEMAN_STATE_DIR;
    process.env.SERVICEMAN_STATE_DIR = state;
    t.after(function () {
        process.env.SERVICEMAN_STATE_DIR = before;
        fs.rmSync(state, {recursive: true, force: true});
    });
    return state;
}

async function boot(t, app)
{
    const servers = await server_start(app);
    await app_ports_here(app);
    t.after(async function () {
        servers.server.close();
        servers.control.close();
        servers.server.closeAllConnections();
        servers.control.closeAllConnections();
        app.config = Object.assign({}, app.config, {apps: Object.assign({}, app.config.apps, {ports: null})});
        await app_ports_here(app);
    });
    return servers.server.address().port;
}
