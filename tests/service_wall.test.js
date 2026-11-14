const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const door_inbound = require('../src/main/src/helpers/door_inbound');
const doors_table = require('../src/main/src/helpers/doors_table');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const handshake_raw = require('./handshake_raw');
const http = require('http');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const service_rename_ties = require('../src/main/src/helpers/service_rename_ties');
const test = require('node:test');

// A service's own wall is a service of the config, and never itself; a rename of the wall
// carries the services it stands in front of with it
test('a service names the wall it stands behind, and the config holds it to one that is there', function () {
    const config = config_from_json({services: [
        {name: 'authwall', type: 'external', publish: {host: 'authwall.test'}, upstream: '127.0.0.1:9'},
        {name: 'notes', type: 'files', publish: {host: 'notes.test'}, auth: 'authwall'},
        {name: 'open', type: 'files', publish: {host: 'open.test'}},
    ]}, '/srv/serviceman');
    assert.strictEqual(config.services[1].auth, 'authwall');
    assert.strictEqual(config.services[2].auth, null, 'none said is none');
    function bad(auth) {
        return function () {
            return config_from_json({services: [
                {name: 'authwall', type: 'external', publish: {host: 'authwall.test'}, upstream: '127.0.0.1:9'},
                {name: 'notes', type: 'files', publish: {host: 'notes.test'}, auth},
            ]}, '/srv/serviceman');
        };
    }
    assert.throws(bad('gate'), /"notes" is behind "gate", and no service has that name/);
    assert.throws(bad('notes'), /"notes" is behind itself/);
    assert.throws(bad(true), /notes.*auth: the name of the service that stands in front of it|services\[1\]\.auth: the name/);
    assert.strictEqual(config_from_json({services: [{name: 'a', type: 'files', publish: {host: 'a.test'}, auth: ''}]}, '/srv').services[0].auth, null, 'an empty one is none');

    const json = {services: [{name: 'authwall'}, {name: 'notes', auth: 'authwall'}, {name: 'open'}], remotes: []};
    service_rename_ties(null, json, 'authwall', 'gate');
    assert.strictEqual(json.services[1].auth, 'gate');
    assert.strictEqual(json.services[2].auth, undefined);
});

// On serviceman's own door: nothing of a walled service is answered, not even whether it is
// up, until the wall said yes; its sign-in is the wall's on the service's own name; who the
// visitor is comes from the wall alone; a service behind no wall never asks it; a websocket is
// held to it the same way
test('a service behind a wall asks it first on serviceman\'s own door, for a request and a websocket', async function (t) {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-wall-'));
    fs.mkdirSync(path.join(state, 'apps', 'notes'), {recursive: true});
    fs.writeFileSync(path.join(state, 'apps', 'notes', 'index.html'), '<title>Notes</title>');
    fs.mkdirSync(path.join(state, 'apps', 'open'), {recursive: true});
    fs.writeFileSync(path.join(state, 'apps', 'open', 'index.html'), '<title>Open</title>');
    const before = process.env.SERVICEMAN_STATE_DIR;
    process.env.SERVICEMAN_STATE_DIR = state;
    let asked = 0;
    const wall = await server_of(function (req, res) {
        if (req.url === '/auth/sidecar') {
            asked++;
            const good = (req.headers.cookie === 'session=good');
            res.writeHead(good ? 200 : 401, good ? {'x-auth-user': 'user@example.com'} : {});
            res.end();
            return;
        }
        res.end(`the wall's own page ${req.url}`);
    });
    const echoed = [];
    const echo = await server_of(function (req, res) {
        echoed.push(req.headers['x-auth-user'] || '');
        res.end(`echo ${req.url} for ${req.headers['x-auth-user'] || 'nobody'}`);
    });
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        services: [
            {name: 'authwall', type: 'external', publish: {host: 'authwall.test'}, upstream: `127.0.0.1:${wall.address().port}`},
            {name: 'notes', type: 'files', publish: {host: 'notes.test'}, auth: 'authwall'},
            {name: 'echo', type: 'external', publish: {host: 'echo.test'}, upstream: `127.0.0.1:${echo.address().port}`, auth: 'authwall'},
            {name: 'open', type: 'files', publish: {host: 'open.test'}},
        ],
    }, state);
    const app = app_from_config(config);
    const servers = await server_start(app);
    const port = servers.server.address().port;
    t.after(function () {
        servers.server.close();
        servers.control.close();
        servers.server.closeAllConnections();
        servers.control.closeAllConnections();
        wall.close();
        echo.close();
        process.env.SERVICEMAN_STATE_DIR = before;
        fs.rmSync(state, {recursive: true, force: true});
    });

    // Not signed in: sent to sign in on the name asked, and the app's page is never read
    const refused = await fetch_host({port, host: 'notes.test', path: '/guide?x=1', token: null});
    assert.strictEqual(refused.status, 302);
    assert.strictEqual(refused.headers.location, '/auth/sign-in?return=%2Fguide%3Fx%3D1');
    assert.strictEqual(asked, 1);
    // Not even whether it is up: the waiting page's own question is behind the wall too
    assert.strictEqual((await fetch_host({port, host: 'notes.test', path: '/__serviceman__/status', token: null})).status, 302);
    assert.strictEqual(asked, 2);

    // The wall's own pages on the app's own name, with no wall in front of them
    const own = await fetch_host({port, host: 'notes.test', path: '/auth/sign-in?return=%2F', token: null});
    assert.strictEqual(own.status, 200);
    assert.strictEqual(own.body, 'the wall\'s own page /auth/sign-in?return=%2F');
    assert.strictEqual(asked, 2);

    // Signed in: the app, once the wall said yes
    const page = await fetch_host({port, host: 'notes.test', path: '/', token: null, headers: {cookie: 'session=good'}});
    assert.strictEqual(page.status, 200);
    assert.strictEqual(page.body, '<title>Notes</title>');
    assert.strictEqual(asked, 3);

    // A program behind it hears who the visitor is from the wall, whatever the visitor claimed
    const through = await fetch_host({port, host: 'echo.test', path: '/hi', token: null, headers: {cookie: 'session=good', 'x-auth-user': 'somebody-else'}});
    assert.strictEqual(through.body, 'echo /hi for user@example.com');
    assert.strictEqual((await fetch_host({port, host: 'echo.test', path: '/hi', token: null})).status, 302);
    assert.deepStrictEqual(echoed, ['user@example.com'], 'the program is never reached by a visitor the wall refused');

    // A service behind no wall is answered as before, and the wall is not asked for it
    const asked_before = asked;
    const open = await fetch_host({port, host: 'open.test', path: '/', token: null});
    assert.strictEqual(open.body, '<title>Open</title>');
    assert.strictEqual(asked, asked_before);

    // A websocket to a service behind the wall is refused without a sign-in
    const shaken = await handshake_raw({port, host: 'echo.test', target: '/socket'});
    assert.strictEqual(shaken, 'HTTP/1.1 401 Unauthorized');
    assert.strictEqual(echoed.length, 1);

    // The wall goes away: nothing behind it is served
    wall.close();
    wall.closeAllConnections();
    const closed = await fetch_host({port, host: 'notes.test', path: '/', token: null, headers: {cookie: 'session=good'}});
    assert.strictEqual(closed.status, 302, 'a wall that cannot be asked is a no');
});

// A machine's door is told the wall a service stands behind, on a name its rule gives with no
// wall, in place of another the rule names, and on a rule written as the service's name alone;
// a name whose service has no wall of its own keeps the rule's
test('a machine\'s door table carries the service\'s own wall', function () {
    const config = config_from_json({
        remotes: [{name: 'laptop', token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', inbound: {
            'notes.example.com': {service: 'notes'},
            'echo.example.com': 'echo',
            'other.example.com': {service: 'notes', auth: 'gate'},
            'open.example.com': {service: 'open', auth: 'gate'},
            'bare.example.com': {service: 'open'},
        }}],
        services: [
            {name: 'authwall', type: 'external', remote: 'laptop', publish: {host: 'authwall.internal'}, upstream: '127.0.0.1:9'},
            {name: 'gate', type: 'external', remote: 'laptop', publish: {host: 'gate.internal'}, upstream: '127.0.0.1:9'},
            {name: 'notes', type: 'external', remote: 'laptop', publish: {host: 'notes.internal'}, upstream: '127.0.0.1:9', auth: 'authwall'},
            {name: 'echo', type: 'external', remote: 'laptop', publish: {host: 'echo.internal'}, upstream: '127.0.0.1:9', auth: 'authwall'},
            {name: 'open', type: 'external', remote: 'laptop', publish: {host: 'open.internal'}, upstream: '127.0.0.1:9'},
        ],
    }, '/srv/serviceman');
    const app = app_from_config(config);
    const table = doors_table(app, app.remote_by_name.laptop);
    assert.deepStrictEqual(table.names['notes.example.com'], {service: 'notes', wall: 'authwall', off: false});
    assert.deepStrictEqual(table.names['echo.example.com'], {service: 'echo', wall: 'authwall', off: false});
    assert.deepStrictEqual(table.names['other.example.com'], {service: 'notes', wall: 'authwall', off: false}, 'its own wall takes the place of the rule\'s');
    assert.deepStrictEqual(table.names['open.example.com'], {service: 'open', wall: 'gate', off: false});
    assert.deepStrictEqual(table.names['bare.example.com'], {service: 'open', wall: null, off: false});
    assert.ok(table.services.authwall !== undefined, 'and the door can reach the wall');

    // serviceman reads a request the door hands it the same way
    function door(host, pathname) {
        const said = door_inbound(app, {headers: {}, socket: {tunnel_from: 'laptop'}}, host, pathname);
        return {service: said.route.service.name, wall: (said.wall === null) ? null : said.wall.name};
    }
    assert.deepStrictEqual(door('notes.example.com', '/'), {service: 'notes', wall: 'authwall'});
    assert.deepStrictEqual(door('notes.example.com', '/auth/sign-in'), {service: 'authwall', wall: null}, 'its sign-in is its wall\'s');
    assert.deepStrictEqual(door('other.example.com', '/auth/sign-in'), {service: 'authwall', wall: null}, 'its own wall\'s, not the rule\'s');
    assert.deepStrictEqual(door('open.example.com', '/'), {service: 'open', wall: 'gate'});
    assert.deepStrictEqual(door('bare.example.com', '/auth/sign-in'), {service: 'open', wall: null}, 'no wall: its /auth is its own');
});

function server_of(handler)
{
    return new Promise(function (resolve) {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', function () {
            resolve(server);
        });
    });
}
