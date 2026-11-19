const agent_door_proxy = require('../src/agent/src/agent_door_proxy');
const agent_door_upgrade = require('../src/agent/src/agent_door_upgrade');
const agent_http_error = require('../src/agent/src/agent_http_error');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const containers_kill = require('./containers_kill');
const crypto = require('crypto');
const doors_table = require('../src/main/src/helpers/doors_table');
const fs = require('fs');
const handshake_raw = require('./handshake_raw');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const service_ensure_running = require('../src/main/src/helpers/service_ensure_running');
const service_phase = require('../src/main/src/helpers/service_phase');
const service_stop = require('../src/main/src/helpers/service_stop');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const DOCKER_BIN = path.join(__dirname, 'bin', 'docker');
// A port nothing answers on: an agent that dials it stands by itself, as with serviceman away
const NOBODY_PORT = 9;
const TOKEN_LAPTOP = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_SERVER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// The final shape of a door: the name reaches the agent of the machine it is on, that agent asks
// the wall — on another machine here — and only a wall that was reached and said yes lets the
// request on to the service, on that other machine as well. serviceman writes the tables and is
// in none of it: it is shut down halfway, and the door goes on as before.
test('a door routes through the wall to the service itself, and goes on with serviceman down', async function () {
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-doors-state-'));
    process.env.SERVICEMAN_STATE_DIR = state_dir;
    // The wall: a cookie it knows is a yes, and says who; anything else is a no. Its own pages
    // answer on the same name.
    const wall = await server_of(function (req, res) {
        if (req.url === '/auth/sidecar') {
            if (req.headers.cookie === 'session=good') {
                res.writeHead(200, {'x-auth-user': 'user@example.com'});
            }
            else {
                res.writeHead(401);
            }
            res.end();
            return;
        }
        res.end(`the wall's own page ${req.url}`);
    });
    const echoed = [];
    const echo = await server_of(function (req, res) {
        echoed.push({url: req.url, user: req.headers['x-auth-user'] || '', relay: req.headers['x-serviceman-relay'] || ''});
        res.end(`echo ${req.url} for ${req.headers['x-auth-user'] || 'nobody'}`);
    });
    const peer_port = await port_free();
    const running = await serviceman_start({
        remotes: [
            {name: 'laptop', token: TOKEN_LAPTOP, inbound: {'echo.example.com': {service: 'echo', auth: 'authwall'}}},
            {name: 'server', token: TOKEN_SERVER},
        ],
        services: [
            {name: 'authwall', type: 'external', remote: 'server', publish: {host: 'authwall.internal'}, upstream: `127.0.0.1:${wall.address().port}`},
            {name: 'echo', type: 'external', remote: 'server', publish: {host: 'echo.internal'}, upstream: `127.0.0.1:${echo.address().port}`},
        ],
    });
    const dir_laptop = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-door-laptop-'));
    const dir_server = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-door-server-'));
    const agents = [
        agent_start(running.control_port, TOKEN_LAPTOP, {SERVICEMAN_AGENT_DIR: dir_laptop, SERVICEMAN_HTTP_SOCKET_MODE: '0600', SERVICEMAN_PEER_PORT: '0'}),
        agent_start(running.control_port, TOKEN_SERVER, {SERVICEMAN_AGENT_DIR: dir_server, SERVICEMAN_PEER_HOST: '127.0.0.1', SERVICEMAN_PEER_PORT: String(peer_port)}),
    ];
    const door = path.join(dir_laptop, 'http.sock');
    try {
        const laptop = running.app.remote_by_name.laptop;
        const server = running.app.remote_by_name.server;
        // Both machines hold the tables written for them — laptop's naming server as its peer
        await wait_until(() => (server.state.doors_peer !== null) && (laptop.state.doors_told !== null) && (laptop.state.doors_told === doors_table(running.app, laptop).version) && (server.state.doors_told === doors_table(running.app, server).version), 15000);
        assert.deepStrictEqual(Object.keys(doors_table(running.app, laptop).peers), ['server']);

        // Not signed in: the wall says no, and the visitor is sent to sign in on the name asked
        const refused = await fetch_socket(door, 'echo.example.com', '/hello');
        assert.strictEqual(refused.status, 302);
        assert.strictEqual(refused.headers.location, '/auth/sign-in?return=%2Fhello');
        assert.deepStrictEqual(echoed, []);

        // The wall's own pages are the wall's, on that same name
        const own = await fetch_socket(door, 'echo.example.com', '/auth/sign-in');
        assert.strictEqual(own.status, 200);
        assert.match(own.body, /the wall's own page \/auth\/sign-in/);

        // Signed in: through, with who they are in the wall's words — whatever the visitor claimed
        const through = await fetch_socket(door, 'echo.example.com', '/hello', {cookie: 'session=good', 'x-auth-user': 'somebody-else', 'x-serviceman-relay': '0'});
        assert.strictEqual(through.status, 200);
        assert.strictEqual(through.body, 'echo /hello for user@example.com');
        // — and marked as come through a door, whatever the visitor said, so the service can tell
        assert.strictEqual(echoed[echoed.length - 1].relay, '1');

        // serviceman goes away. The door is the agent's, and so is the table it routes by.
        await running.close();
        await wait_until(() => fs.existsSync(door), 1000);
        const alone = await fetch_socket(door, 'echo.example.com', '/still', {cookie: 'session=good'});
        assert.strictEqual(alone.status, 200);
        assert.strictEqual(alone.body, 'echo /still for user@example.com');
        const alone_refused = await fetch_socket(door, 'echo.example.com', '/still');
        assert.strictEqual(alone_refused.status, 302);

        // A name the table does not have is serviceman's to answer, and serviceman is away
        const unknown = await fetch_socket(door, 'other.example.com', '/');
        assert.strictEqual(unknown.status, 503);
        assert.strictEqual(unknown.body, '503 Service Unavailable\n');

        // The wall goes away too: nothing behind it is served, and the service is never touched
        const before = echoed.length;
        await close_server(wall);
        const closed = await fetch_socket(door, 'echo.example.com', '/after', {cookie: 'session=good'});
        // — and the visitor is told no more than that: which wall, and why, is the machine's log
        assert.strictEqual(closed.status, 502);
        assert.strictEqual(closed.body, '502 Bad Gateway\n');
        assert.strictEqual(echoed.length, before);

        // The table is on laptop's disk: an agent that starts again with serviceman still away
        // serves what it served before
        assert.strictEqual(fs.existsSync(path.join(dir_laptop, 'doors', 'table.json')), true);
    }
    finally {
        for (const agent of agents) {
            agent.kill('SIGKILL');
        }
        await running.close();
        echo.close();
        wall.close();
        delete process.env.SERVICEMAN_STATE_DIR;
    }
});

// A store for each user: /_couch on the app's own name is answered by the agent at the door of
// the machine its CouchDB runs on. The wall says who the visitor is; the agent makes that user's
// database the first time, with that user alone as its member, and carries the request on to it
// with the name signed by the CouchDB's secret. A name the visitor wrote is dropped, a path out
// of the user's database is refused, and serviceman is in none of it.
test('a door answers /_couch with the signed-in user\'s own CouchDB database, made the first time', async function () {
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-couch-state-'));
    process.env.SERVICEMAN_STATE_DIR = state_dir;
    const SECRET = 'c'.repeat(64);
    const wall = await server_of(function (req, res) {
        if (req.url === '/auth/sidecar') {
            const user = {'session=alice': 'alice@example.com', 'session=bob': 'bob'}[req.headers.cookie];
            res.writeHead((user === undefined) ? 401 : 200, (user === undefined) ? {} : {'x-auth-user': user});
            res.end();
            return;
        }
        res.end('the wall\'s own page');
    });
    const app_asked = [];
    const notes = await server_of(function (req, res) {
        app_asked.push(req.url);
        res.end(`the app ${req.url}`);
    });
    // CouchDB as far as the door meets it: its admin makes a database and gives it to a user; a
    // name counts only with its token, signed by the secret, and only at a database it is a member of
    const couch_asked = [];
    const members = {};
    const couch = await server_of(function (req, res) {
        const admin = (req.headers.authorization === `Basic ${Buffer.from('admin:pw').toString('base64')}`);
        const user = req.headers['x-forwarded-user'];
        const signed = (user !== undefined) && (req.headers['x-forwarded-user-token'] === crypto.createHmac('sha256', SECRET).update(user).digest('hex'));
        const database = req.url.split('/')[1].split('?')[0];
        couch_asked.push({method: req.method, url: req.url, admin, user: signed ? user : null, cookie: req.headers.cookie || null});
        if (admin && (req.method === 'PUT') && (req.url === `/${database}`)) {
            res.writeHead((members[database] === undefined) ? 201 : 412);
            members[database] = members[database] || [];
            res.end();
            return;
        }
        if (admin && (req.method === 'PUT') && req.url.endsWith('/_security')) {
            const body = [];
            req.on('data', v => body.push(v));
            req.on('end', function () {
                members[database] = JSON.parse(Buffer.concat(body).toString('utf8')).members.names;
                res.writeHead(200);
                res.end();
            });
            return;
        }
        if (signed && (members[database] || []).includes(user)) {
            res.end(JSON.stringify({user, url: req.url}));
            return;
        }
        res.writeHead(signed ? 403 : 401);
        res.end();
    });
    fs.writeFileSync(path.join(state_dir, 'databases.json'), JSON.stringify({servers: [
        {name: 'couchdb-1', engine: 'couchdb', version: '3', remote: 'laptop', phase: 'up', port: couch.address().port, secret: SECRET, users: {admin: {user: 'admin', password: 'pw'}}},
        {name: 'couchdb-9', engine: 'couchdb', version: '3', remote: 'server', phase: 'up', port: 1, secret: SECRET, users: {admin: {user: 'admin', password: 'pw'}}},
    ]}));
    const running = await serviceman_start({
        remotes: [
            {name: 'laptop', token: TOKEN_LAPTOP, inbound: {
                'notes.example.com': {service: 'notes', auth: 'authwall'},
                'open.example.com': 'open',
                'far.example.com': {service: 'far', auth: 'authwall'},
            }},
            {name: 'server', token: TOKEN_SERVER},
        ],
        services: [
            {name: 'authwall', type: 'external', remote: 'laptop', publish: {host: 'authwall.internal'}, upstream: `127.0.0.1:${wall.address().port}`},
            {name: 'notes', type: 'external', remote: 'laptop', publish: {host: 'notes.internal'}, upstream: `127.0.0.1:${notes.address().port}`, store: {server: 'couchdb-1'}},
            {name: 'open', type: 'external', remote: 'laptop', publish: {host: 'open.internal'}, upstream: `127.0.0.1:${notes.address().port}`, store: {server: 'couchdb-1'}},
            {name: 'far', type: 'external', remote: 'laptop', publish: {host: 'far.internal'}, upstream: `127.0.0.1:${notes.address().port}`, store: {server: 'couchdb-9'}},
        ],
    });
    const dir_laptop = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-couch-laptop-'));
    const agent = agent_start(running.control_port, TOKEN_LAPTOP, {SERVICEMAN_AGENT_DIR: dir_laptop, SERVICEMAN_HTTP_SOCKET_MODE: '0600', SERVICEMAN_PEER_PORT: '0'});
    const door = path.join(dir_laptop, 'http.sock');
    const alice_db = `userdb-${Buffer.from('alice@example.com').toString('hex')}`;
    try {
        const laptop = running.app.remote_by_name.laptop;
        await wait_until(() => (laptop.state.doors_told !== null) && (laptop.state.doors_told === doors_table(running.app, laptop).version) && fs.existsSync(door), 15000);
        // serviceman names the CouchDB only where the agent can answer for it: behind a wall,
        // and on the machine it runs on
        const names = doors_table(running.app, laptop).names;
        assert.deepStrictEqual(names['notes.example.com'].couch, {port: couch.address().port, secret: SECRET, admin: {user: 'admin', password: 'pw'}});
        assert.strictEqual(names['open.example.com'].couch, undefined, 'no wall, nobody to make a store for');
        assert.strictEqual(names['far.example.com'].couch, undefined, 'its CouchDB is on another machine');

        // Not signed in: sent to sign in, and CouchDB never asked
        const refused = await fetch_socket(door, 'notes.example.com', '/_couch/note-1');
        assert.strictEqual(refused.status, 302);
        assert.deepStrictEqual(couch_asked, []);

        // Signed in: alice's database made and given to her alone, then her request carried
        // there with her name signed; her own claims and cookie stay at the door
        const first = await fetch_socket(door, 'notes.example.com', '/_couch/note-1?rev=2', {'cookie': 'session=alice', 'x-forwarded-user': 'bob', 'x_forwarded_user_token': 'forged'});
        assert.strictEqual(first.status, 200);
        assert.deepStrictEqual(JSON.parse(first.body), {user: 'alice@example.com', url: `/${alice_db}/note-1?rev=2`});
        assert.deepStrictEqual(couch_asked.map(v => `${v.method} ${v.url} ${v.admin ? 'admin' : v.user}`), [`PUT /${alice_db} admin`, `PUT /${alice_db}/_security admin`, `GET /${alice_db}/note-1?rev=2 alice@example.com`]);
        assert.strictEqual(couch_asked[2].cookie, null);
        assert.deepStrictEqual(members[alice_db], ['alice@example.com']);

        // The second time it is there already: straight to it
        const again = await fetch_socket(door, 'notes.example.com', '/_couch', {cookie: 'session=alice'});
        assert.strictEqual(again.status, 200);
        assert.strictEqual(JSON.parse(again.body).url, `/${alice_db}`);
        assert.strictEqual(couch_asked.length, 4);

        // bob has his own, and no way to name alice's: a path out of his is refused at the door
        const bob = await fetch_socket(door, 'notes.example.com', '/_couch/', {cookie: 'session=bob'});
        assert.strictEqual(JSON.parse(bob.body).url, `/userdb-${Buffer.from('bob').toString('hex')}/`);
        for (const step_out of [`/_couch/../${alice_db}`, `/_couch/%2e%2e/${alice_db}`, '/_couch/./x/..']) {
            const stepped = await fetch_socket(door, 'notes.example.com', step_out, {cookie: 'session=bob'});
            assert.strictEqual(stepped.status, 400, step_out);
        }

        // Everything else on the name is the app's, as before
        const app_page = await fetch_socket(door, 'notes.example.com', '/_couchdb', {cookie: 'session=alice'});
        assert.strictEqual(app_page.body, 'the app /_couchdb');
        const open = await fetch_socket(door, 'open.example.com', '/_couch');
        assert.strictEqual(open.body, 'the app /_couch');
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
        for (const server of [wall, notes, couch]) {
            server.close();
        }
        delete process.env.SERVICEMAN_STATE_DIR;
    }
});

// One rule for every app under a domain: "*" is answered by the service whose own address the
// name is, a folder of files here, behind the wall, which is asked once per visit, by serviceman;
// a name no app has is a 404 and never reaches the wall, and the wall's own pages are the wall's
test('a door rule of * answers each name with the app whose address it is, the wall asked once', async function () {
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-doors-state-'));
    process.env.SERVICEMAN_STATE_DIR = state_dir;
    fs.mkdirSync(path.join(state_dir, 'apps', 'notes'), {recursive: true});
    fs.writeFileSync(path.join(state_dir, 'apps', 'notes', 'index.html'), '<title>Notes</title>');
    let asked = 0;
    const wall = await server_of(function (req, res) {
        if (req.url === '/auth/sidecar') {
            asked++;
            res.writeHead((req.headers.cookie === 'session=good') ? 200 : 401, (req.headers.cookie === 'session=good') ? {'x-auth-user': 'user@example.com'} : {});
            res.end();
            return;
        }
        res.end(`the wall's own page ${req.url}`);
    });
    const running = await serviceman_start({
        apps: {domain: 'apps.example.com'},
        remotes: [{name: 'laptop', token: TOKEN_LAPTOP, inbound: {'*.apps.example.com': {service: '*', auth: 'authwall'}, 'apps.example.com': {service: '*', auth: 'authwall'}}}],
        services: [
            {name: 'authwall', type: 'external', publish: {host: 'authwall.internal'}, upstream: `127.0.0.1:${wall.address().port}`},
            {name: 'notes', type: 'files', publish: {host: 'notes.apps.example.com'}},
        ],
    });
    const dir_laptop = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-door-laptop-'));
    const agent = agent_start(running.control_port, TOKEN_LAPTOP, {SERVICEMAN_AGENT_DIR: dir_laptop, SERVICEMAN_HTTP_SOCKET_MODE: '0600', SERVICEMAN_PEER_PORT: '0'});
    const door = path.join(dir_laptop, 'http.sock');
    try {
        const laptop = running.app.remote_by_name.laptop;
        await wait_until(() => (laptop.state.doors_told !== null) && (laptop.state.doors_told === doors_table(running.app, laptop).version) && fs.existsSync(door), 15000);

        const refused = await fetch_socket(door, 'notes.apps.example.com', '/');
        assert.strictEqual(refused.status, 302);
        assert.strictEqual(refused.headers.location, '/auth/sign-in?return=%2F');
        assert.strictEqual(asked, 1, 'the wall is asked once, by serviceman, not again by the door');

        const page = await fetch_socket(door, 'notes.apps.example.com', '/', {cookie: 'session=good'});
        assert.strictEqual(page.status, 200);
        assert.strictEqual(page.body, '<title>Notes</title>');
        const kept = await fetch_socket(door, 'notes.apps.example.com', '/notes/42', {cookie: 'session=good'});
        assert.strictEqual(kept.body, '<title>Notes</title>');
        assert.strictEqual(asked, 3);

        const none = await fetch_socket(door, 'other.apps.example.com', '/', {cookie: 'session=good'});
        assert.strictEqual(none.status, 404, 'a name no app has');
        assert.strictEqual(asked, 3, 'and the wall is not asked for it');

        const own = await fetch_socket(door, 'notes.apps.example.com', '/auth/sign-in');
        assert.strictEqual(own.status, 200);
        assert.match(own.body, /the wall's own page \/auth\/sign-in/);
        assert.strictEqual(asked, 3);

        // The domain itself is the page of its apps, behind the same wall
        assert.strictEqual((await fetch_socket(door, 'apps.example.com', '/')).status, 302);
        const home = await fetch_socket(door, 'apps.example.com', '/', {cookie: 'session=good'});
        assert.strictEqual(home.status, 200);
        assert.ok(home.body.includes('href="//notes.apps.example.com/"'), 'a cell for notes, on the name the door answers');
        assert.strictEqual(asked, 5);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
        wall.close();
        delete process.env.SERVICEMAN_STATE_DIR;
    }
});

// A board published on the laptop: its agent answers it on 127.0.0.1 and nowhere else, the
// board at its name under .localhost, each app on it at its own, and any other name with a 404.
// The board's page and an app serviceman serves itself go to serviceman over the link, one trip.
test('a board published on a machine is answered on its loopback alone, its apps at their names', async function () {
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-board-state-'));
    process.env.SERVICEMAN_STATE_DIR = state_dir;
    for (const name of ['notes', 'mail']) {
        fs.mkdirSync(path.join(state_dir, 'apps', name), {recursive: true});
        fs.writeFileSync(path.join(state_dir, 'apps', name, 'index.html'), `<title>${name}</title>`);
    }
    const port = await port_free();
    // An app that takes a websocket, as Visual Agency does
    const chat = await server_of(function (req, res) {
        res.end('chat');
    });
    chat.on('upgrade', function (req, socket) {
        socket.end('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n');
    });
    const running = await serviceman_start({
        remotes: [{name: 'laptop', token: TOKEN_LAPTOP}],
        services: [
            {name: 'notes', type: 'files', publish: {host: 'notes.localhost'}},
            {name: 'mail', type: 'files', publish: {host: 'mail.localhost'}},
            {name: 'chat', type: 'external', publish: {host: 'chat.localhost'}, upstream: `127.0.0.1:${chat.address().port}`},
        ],
        boards: [{name: 'home', machines: ['laptop'], apps: ['notes', 'chat'], port}],
    });
    const dir_laptop = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-board-laptop-'));
    const agent = agent_start(running.control_port, TOKEN_LAPTOP, {SERVICEMAN_AGENT_DIR: dir_laptop, SERVICEMAN_PEER_PORT: '0'});
    try {
        const laptop = running.app.remote_by_name.laptop;
        await wait_until(() => (laptop.state.doors_told !== null) && (laptop.state.doors_told === doors_table(running.app, laptop).version), 15000);
        await wait_until_listening(port, 5000);

        const notes = await fetch_port(port, {host: `notes.localhost:${port}`});
        assert.strictEqual(notes.status, 200);
        assert.strictEqual(notes.body, '<title>notes</title>');

        const board = await fetch_port(port, {host: `home.localhost:${port}`});
        assert.strictEqual(board.status, 200);
        assert.ok(board.body.includes(`href="//notes.localhost:${port}/"`), 'the board opens its app at its name, on the board\'s port');
        assert.strictEqual(board.body.includes('mail.localhost'), false, 'an app not on the board has no cell');
        assert.match(board.body, /<h1>home<\/h1>/);

        assert.strictEqual(await handshake_raw({port, host: `chat.localhost:${port}`, target: '/ws'}), 'HTTP/1.1 101 Switching Protocols', 'a websocket of an app on it');
        assert.strictEqual((await fetch_port(port, {host: `mail.localhost:${port}`})).status, 404, 'an app on no board here');
        assert.strictEqual((await fetch_port(port, {host: `serviceman.localhost:${port}`})).status, 404, 'never the control page');

        // Nowhere but the loopback: the machine's other addresses take no connection
        for (const address of addresses_not_loopback()) {
            assert.strictEqual(await connects(address, port), false, `${address}:${port} takes no connection`);
        }
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
        await close_server(chat);
        delete process.env.SERVICEMAN_STATE_DIR;
    }
});

// A service that sleeps is woken by the door itself, and only answered once the program in it
// answers: docker's port takes connections the moment the container starts and drops them
// until then, which a door that trusted the open port would pass on as a 502. serviceman is told
// at once, and its page says the service runs.
test('a door wakes a sleeping service, waits for it to answer, and serviceman sees it run', async function () {
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-doors-state-'));
    process.env.SERVICEMAN_STATE_DIR = state_dir;
    process.env.SERVICEMAN_TEST_STATE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-')), 'docker.json');
    const running = await serviceman_start({
        remotes: [{name: 'laptop', token: TOKEN_LAPTOP, inbound: {'sleepy.example.com': 'sleepy'}}],
        services: [{name: 'sleepy', type: 'docker', remote: 'laptop', publish: {host: 'sleepy.internal', port: 8080}, image: 'demo/sleepy'}],
    });
    const dir_laptop = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-door-laptop-'));
    const agent = agent_start(running.control_port, TOKEN_LAPTOP, {SERVICEMAN_AGENT_DIR: dir_laptop, SERVICEMAN_HTTP_SOCKET_MODE: '0600', SERVICEMAN_PEER_PORT: '0', SERVICEMAN_TEST_DEAF_MS: '800'}, ['--docker', DOCKER_BIN]);
    const door = path.join(dir_laptop, 'http.sock');
    try {
        const laptop = running.app.remote_by_name.laptop;
        const service = running.app.service_by_name.sleepy;
        await wait_until(() => (laptop.state.phase === 'online') && (laptop.state.doors_told !== null) && (laptop.state.doors_told === doors_table(running.app, laptop).version), 15000);
        // It ran once — serviceman made the container — and went to sleep
        await service_ensure_running(running.app, service);
        await service_stop(running.app, service, 'the test puts it to sleep');
        assert.strictEqual(service_phase(service), 'stopped');

        // The door starts it and waits through the time its port drops every connection
        const woken = await fetch_socket(door, 'sleepy.example.com', '/');
        assert.strictEqual(woken.status, 200);

        // And serviceman is told, so the page says it runs
        await wait_until(() => service_phase(service) === 'running', 5000);
        assert.strictEqual(running.app.log_lines.some(v => v.includes('[service_adopt_ok] service=sleepy')), true);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
        // The container the door woke is a process of the stand-in docker, and outlives the
        // agent that started it, as a real one does: it is stopped with the test
        containers_kill();
        fs.rmSync(path.dirname(process.env.SERVICEMAN_TEST_STATE), {recursive: true, force: true});
        fs.rmSync(dir_laptop, {recursive: true, force: true});
        fs.rmSync(state_dir, {recursive: true, force: true});
        delete process.env.SERVICEMAN_TEST_STATE;
        delete process.env.SERVICEMAN_STATE_DIR;
    }
});

// A far end that takes no connection — a machine asleep, or off the tailnet — is a 502 at once,
// for a request and for a websocket, not a wait until the system gives up minutes later.
// 192.0.2.1 is an address nothing answers on.
test('a door answers 502 at once when the far end takes no connection', async function () {
    const connect_ms = agent_door_proxy.connect_ms;
    agent_door_proxy.connect_ms = 300;
    const away = {host: '192.0.2.1', port: 9};
    const front = await server_of(function (req, res) {
        agent_door_proxy(req, res, away, {});
    });
    front.on('upgrade', function (req, socket, head) {
        agent_door_upgrade(req, socket, head, away, {});
    });
    try {
        const time0 = Date.now();
        const answer = await fetch_port(front.address().port, {});
        assert.strictEqual(answer.status, 502);
        assert.ok(Date.now() - time0 < 2000);

        const time1 = Date.now();
        const closed = await fetch_port(front.address().port, {connection: 'upgrade', upgrade: 'websocket'});
        assert.strictEqual(closed.status, 'closed');
        assert.ok(Date.now() - time1 < 2000);
    }
    finally {
        agent_door_proxy.connect_ms = connect_ms;
        await close_server(front);
    }
});

// A service behind a door may answer what no HTTP has: a status of 99 or of 0, or status words
// with a control byte in them. Node's client takes those and node's server refuses to say them:
// thrown where the answer is passed on, in a callback nothing catches, it ended the agent.
test('a door answers 502 for an answer no HTTP has, and carries the next one as ever', async function (t) {
    const said = ['099 Odd', '000 Zero', '200 O\u0001K', '204 No Content'];
    const service = net.createServer(function (socket) {
        socket.once('data', function () {
            socket.end(`HTTP/1.1 ${said.shift()}\r\ncontent-length: 0\r\n\r\n`);
        });
    });
    await new Promise(function (resolve) {
        service.listen(0, '127.0.0.1', resolve);
    });
    const front = await server_of(function (req, res) {
        agent_door_proxy(req, res, {host: '127.0.0.1', port: service.address().port}, {});
    });
    t.after(async function () {
        service.close();
        await close_server(front);
    });
    for (const status of [502, 502, 502, 204]) {
        assert.strictEqual((await fetch_port(front.address().port, {})).status, status);
    }
});

// The peer port is reached by every device of the tailnet, and by anything on the machine, with
// no token at all. The refusal is written to whoever sent the handshake, and that one may be
// gone already: a reset right behind the handshake makes the write an error on a socket of the
// agent's own.
test('a handshake that is reset on the peer port costs its socket alone, and the agent goes on', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-door-server-'));
    const peer_port = await port_free();
    const agent = agent_start(NOBODY_PORT, TOKEN_SERVER, {SERVICEMAN_AGENT_DIR: dir, SERVICEMAN_PEER_HOST: '127.0.0.1', SERVICEMAN_PEER_PORT: String(peer_port)});
    const lines = lines_of(agent);
    try {
        await wait_until(() => lines.join('').includes('[peer_serve_begin]'), 5000);
        for (let i = 0; i < 8; i++) {
            assert.strictEqual(await handshake_raw({port: peer_port, host: '127.0.0.1', target: '/', reset: true}), 'closed');
        }
        const after = await fetch_port(peer_port, {});
        assert.strictEqual(after.status, 403);
    }
    finally {
        agent.kill('SIGKILL');
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// What answering one caller throws is that caller's 500, or its socket closed, and a line in the
// machine's log. Here it is a service written with a port past 65535, which the config takes:
// node refuses to ask such an address at all, where an address nobody answers on is a 502.
test('a service whose address cannot be asked is a 500 at the peer port and at the door, and the agent goes on', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-door-server-'));
    const peer_port = await port_free();
    // The table an agent kept is the one it serves by when it starts with serviceman away
    fs.mkdirSync(path.join(dir, 'doors'));
    fs.writeFileSync(path.join(dir, 'doors', 'table.json'), JSON.stringify({
        version: 'test',
        self: 'server',
        token: TOKEN_SERVER,
        names: {'echo.example.com': {service: 'echo', wall: null, off: false}},
        services: {echo: {service: 'echo', machine: 'server', kind: 'external', upstream: '127.0.0.1:99999'}},
        peers: {},
    }));
    const agent = agent_start(NOBODY_PORT, TOKEN_SERVER, {SERVICEMAN_AGENT_DIR: dir, SERVICEMAN_HTTP_SOCKET_MODE: '0600', SERVICEMAN_PEER_HOST: '127.0.0.1', SERVICEMAN_PEER_PORT: String(peer_port)});
    const lines = lines_of(agent);
    const door = path.join(dir, 'http.sock');
    const asking = {'x-serviceman-peer': TOKEN_SERVER, 'x-serviceman-service': 'echo'};
    try {
        await wait_until(() => lines.join('').includes('[peer_serve_begin]') && lines.join('').includes('[http_socket_begin]'), 5000);

        // A peer that asks for it, and a peer's websocket
        const peer = await fetch_port(peer_port, asking);
        assert.deepStrictEqual([peer.status, peer.body], [500, '500 Internal Server Error\n']);
        assert.strictEqual(await handshake_raw({port: peer_port, host: '127.0.0.1', target: '/', headers: asking}), 'closed');

        // A visitor at this machine's own door, and a visitor's websocket
        const visitor = await fetch_socket(door, 'echo.example.com', '/');
        assert.deepStrictEqual([visitor.status, visitor.body], [500, '500 Internal Server Error\n']);
        await assert.rejects(fetch_socket(door, 'echo.example.com', '/', {connection: 'upgrade', upgrade: 'websocket'}));

        // Each is said in the machine's log, and the agent answers the next one
        await wait_until(() => ['peer_request_error', 'peer_upgrade_error', 'door_request_error', 'door_upgrade_error'].every(v => lines.join('').includes(`[${v}] `)), 2000);
        const after = await fetch_port(peer_port, {});
        assert.strictEqual(after.status, 403);
    }
    finally {
        agent.kill('SIGKILL');
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// A machine nobody is told to ask keeps no token of its own, and its peer port opens to no one:
// a caller that sends the word null, or nothing, is not a machine of the fleet, and never reaches
// a service that runs here past the wall in front of it
test('a machine nobody asks lets no caller through its peer port, whatever token it sends', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-door-server-'));
    const peer_port = await port_free();
    let reached = 0;
    const echo = http.createServer(function (req, res) {
        reached++;
        res.end('echo answered');
    });
    echo.on('upgrade', function (req, socket) {
        reached++;
        socket.destroy();
    });
    await new Promise(v => echo.listen(0, '127.0.0.1', v));
    fs.mkdirSync(path.join(dir, 'doors'));
    fs.writeFileSync(path.join(dir, 'doors', 'table.json'), JSON.stringify({
        version: 'test',
        self: 'server',
        token: null,
        names: {'echo.example.com': {service: 'echo', wall: 'authwall', off: false}},
        services: {echo: {service: 'echo', machine: 'server', kind: 'external', upstream: `127.0.0.1:${echo.address().port}`}},
        peers: {},
    }));
    const agent = agent_start(NOBODY_PORT, TOKEN_SERVER, {SERVICEMAN_AGENT_DIR: dir, SERVICEMAN_PEER_HOST: '127.0.0.1', SERVICEMAN_PEER_PORT: String(peer_port)});
    const lines = lines_of(agent);
    try {
        await wait_until(() => lines.join('').includes('[peer_serve_begin]'), 5000);
        for (const token of ['null', 'undefined', '', TOKEN_SERVER]) {
            const answer = await fetch_port(peer_port, {'x-serviceman-peer': token, 'x-serviceman-service': 'echo'});
            assert.deepStrictEqual([token, answer.status], [token, 403]);
        }
        assert.strictEqual(await handshake_raw({port: peer_port, host: '127.0.0.1', target: '/', headers: {'x-serviceman-peer': 'null', 'x-serviceman-service': 'echo'}}), 'HTTP/1.1 502 Bad Gateway');
        assert.strictEqual(reached, 0);
    }
    finally {
        agent.kill('SIGKILL');
        echo.close();
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

// The door is a file, so who the visitor is comes from the front alone, and the front writes it
// after whatever the visitor wrote: the docs' nginx block sends `X-Real-IP $remote_addr` and
// `X-Forwarded-For $proxy_add_x_forwarded_for`, the visitor's own list with the address the
// front saw at its end. The requests here are what the door receives from a front that saw the
// visitor at 203.0.113.9 (2001:db8::9), for a visitor who wrote 198.51.100.77 everywhere.
test('a door tells the wall the address its front wrote, and never one the visitor wrote', async function () {
    const alone = await door_alone();
    const asks = [
        // The docs' front, and a visitor who sent both headers
        [{'x-real-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.77, 203.0.113.9'}, '203.0.113.9'],
        // A visitor who sent a list, in two lines, and a front that adds a line of its own
        [{'x-forwarded-for': ['198.51.100.77, 198.51.100.78', '198.51.100.79', '203.0.113.9']}, '203.0.113.9'],
        [{'x-real-ip': '2001:db8::9', 'x-forwarded-for': '198.51.100.77, 2001:db8::9'}, '2001:db8::9'],
        // A front that writes x-forwarded-for over the visitor's and leaves their x-real-ip
        [{'x-real-ip': '198.51.100.77', 'x-forwarded-for': '203.0.113.9'}, '203.0.113.9'],
        // A front that writes x-real-ip alone
        [{'x-real-ip': '203.0.113.9'}, '203.0.113.9'],
        // No front wrote either of these: what is not an address is not told as one
        [{'x-real-ip': ['198.51.100.77', '198.51.100.78'], 'x-forwarded-for': '198.51.100.77, <script>'}, ''],
        [{'x-real-ip': 'localhost', 'x-forwarded-for': '198.51.100.77,'}, ''],
        // Nobody in front, and nothing written
        [{}, ''],
    ];
    try {
        for (const [headers, address] of asks) {
            const answer = await fetch_socket(alone.door, 'walled.example.com', '/page', Object.assign({cookie: 'session=good'}, headers));
            assert.strictEqual(answer.status, 200);
            assert.strictEqual(alone.told[alone.told.length - 1], address, JSON.stringify(headers));
        }
        // A websocket's handshake is asked about the same way
        assert.strictEqual(await shake_socket(alone.door, 'walled.example.com', {cookie: 'session=good', 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.77, 203.0.113.9'}), 101);
        assert.strictEqual(alone.told[asks.length], '203.0.113.9');
        assert.strictEqual(alone.told.length, asks.length + 1);
    }
    finally {
        alone.close();
    }
});

// What a visitor writes into x-auth-user is dropped under either spelling a stack behind may
// read as that name (CGI, WSGI and PHP hand a program `_` and `-` as one), sent once, twice or
// as a list: behind a wall the service reads the wall's word and nothing beside it, with no
// wall it is told nothing. The door's own mark is kept the same way.
test('a visitor\'s x-auth-user reaches no service through a door, under either spelling, and the door\'s mark is the only one', async function () {
    const alone = await door_alone();
    const claim = {'x-auth-user': ['owner@example.com', 'root@example.com'], 'X_Auth_User': 'owner@example.com, root@example.com', 'x_serviceman_relay': '0', 'X-Serviceman_Relay': '0'};
    try {
        // Behind the wall: a request, then a handshake
        const walled = await fetch_socket(alone.door, 'walled.example.com', '/page', Object.assign({cookie: 'session=good'}, claim));
        assert.strictEqual(walled.status, 200);
        assert.strictEqual(await shake_socket(alone.door, 'walled.example.com', Object.assign({cookie: 'session=good'}, claim)), 101);
        // A name with no wall: nobody said who the visitor is
        const open = await fetch_socket(alone.door, 'open.example.com', '/page', claim);
        assert.strictEqual(open.status, 200);
        assert.strictEqual(await shake_socket(alone.door, 'open.example.com', claim), 101);
        const word = {'x-auth-user': 'user@example.com', 'x-serviceman-relay': '1'};
        assert.deepStrictEqual(alone.said, [word, word, {'x-serviceman-relay': '1'}, {'x-serviceman-relay': '1'}]);
    }
    finally {
        alone.close();
    }
});

// What the door cannot route it hands to serviceman over the link, and serviceman asks the wall:
// here the wall and the service run with serviceman, on no machine. A stream of a link has no
// address of its own, and the wall is not told nothing for that: it is told what the front of
// that machine wrote, by the same rule as the machine's own door, and the log says the same.
test('serviceman tells the wall the address a machine\'s front wrote, for what the door hands it over the link', async function () {
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-doors-state-'));
    process.env.SERVICEMAN_STATE_DIR = state_dir;
    const told = [];
    const wall = await server_of(function (req, res) {
        told.push(req.headers['x-real-ip']);
        res.writeHead((req.headers.cookie === 'session=good') ? 200 : 401, {'x-auth-user': 'user@example.com'});
        res.end();
    });
    const echo = await server_of(function (req, res) {
        res.end('the page');
    });
    echo.on('upgrade', function (req, socket) {
        socket.end('HTTP/1.1 101 Switching Protocols\r\nconnection: upgrade\r\nupgrade: websocket\r\n\r\n');
    });
    const running = await serviceman_start({
        remotes: [{name: 'laptop', token: TOKEN_LAPTOP, inbound: {'walled.example.com': {service: 'echo', auth: 'authwall'}}}],
        services: [
            {name: 'authwall', type: 'external', publish: {host: 'authwall.internal'}, upstream: `127.0.0.1:${wall.address().port}`},
            {name: 'echo', type: 'external', publish: {host: 'echo.internal'}, upstream: `127.0.0.1:${echo.address().port}`},
        ],
    });
    const dir_laptop = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-door-laptop-'));
    const agent = agent_start(running.control_port, TOKEN_LAPTOP, {SERVICEMAN_AGENT_DIR: dir_laptop, SERVICEMAN_HTTP_SOCKET_MODE: '0600', SERVICEMAN_PEER_PORT: '0'});
    const door = path.join(dir_laptop, 'http.sock');
    const asks = [
        [{'x-real-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.77, 203.0.113.9'}, '203.0.113.9'],
        [{'x-forwarded-for': ['198.51.100.77, 198.51.100.78', '2001:db8::9']}, '2001:db8::9'],
        [{'x-real-ip': '203.0.113.9'}, '203.0.113.9'],
        [{'x-real-ip': ['198.51.100.77', '198.51.100.78'], 'x-forwarded-for': '198.51.100.77, <script>'}, ''],
        [{}, ''],
    ];
    try {
        const laptop = running.app.remote_by_name.laptop;
        await wait_until(() => (laptop.state.phase === 'online') && (laptop.state.doors_told !== null) && (laptop.state.doors_told === doors_table(running.app, laptop).version), 15000);
        for (const [headers, address] of asks) {
            const answer = await fetch_socket(door, 'walled.example.com', '/page', Object.assign({cookie: 'session=good'}, headers));
            assert.strictEqual(answer.status, 200);
            assert.strictEqual(told[told.length - 1], address, JSON.stringify(headers));
            assert.ok(running.app.log_lines.findLast(v => v.includes('[request_begin]')).includes(`"ip":"${address}"`), JSON.stringify(headers));
        }
        // A websocket's handshake is asked about the same way
        assert.strictEqual(await shake_socket(door, 'walled.example.com', {cookie: 'session=good', 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.77, 203.0.113.9'}), 101);
        assert.strictEqual(told[asks.length], '203.0.113.9');
        // At serviceman's own door the socket says who asked, whatever the visitor wrote
        const own = await fetch_port(running.app.servers.server.address().port, {host: 'echo.internal', 'x-real-ip': '198.51.100.77', 'x-forwarded-for': '198.51.100.77'});
        assert.strictEqual(own.status, 200);
        assert.match(running.app.log_lines.findLast(v => v.includes('[request_begin]')), /"ip":"(::ffff:)?127\.0\.0\.1"/);
    }
    finally {
        agent.kill('SIGKILL');
        await running.close();
        echo.close();
        echo.closeAllConnections();
        wall.close();
        wall.closeAllConnections();
        fs.rmSync(dir_laptop, {recursive: true, force: true});
        fs.rmSync(state_dir, {recursive: true, force: true});
        delete process.env.SERVICEMAN_STATE_DIR;
    }
});

// The error a door answers with is a whole answer: one already begun cannot become another
test('an error for an answer already begun cuts it where it is', async function () {
    const thrown = [];
    const front = await server_of(function (req, res) {
        res.writeHead(200, {'content-type': 'text/plain'});
        res.write('begun', function () {
            try {
                agent_http_error(res, 500);
            }
            catch (error) {
                thrown.push(error.code);
                res.destroy();
            }
        });
    });
    try {
        const cut = await new Promise(function (resolve) {
            http.get({host: '127.0.0.1', port: front.address().port, agent: false}, function (answer) {
                answer.resume();
                answer.on('close', () => resolve({status: answer.statusCode, complete: answer.complete}));
            });
        });
        assert.deepStrictEqual(cut, {status: 200, complete: false});
        assert.deepStrictEqual(thrown, []);
    }
    finally {
        await close_server(front);
    }
});

async function serviceman_start(json)
{
    const config = config_from_json(Object.assign({listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}}, json), __dirname);
    const app = app_from_config(config);
    const servers = await server_start(app);
    let closed = false;
    return {
        app,
        control_port: servers.control.address().port,
        close: async function () {
            if (closed) {
                return;
            }
            closed = true;
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
            for (const timer of Object.values(app.timers || {})) {
                clearInterval(timer);
            }
        },
    };
}

// A machine's door with serviceman away: an agent that serves by the table it kept, a wall that
// knows one cookie and a service, both on that machine. `told` has the x-real-ip the wall was
// asked with, per ask; `said` has, per request and per handshake the service got, every header
// a stack may read as x-auth-user or as the door's mark.
async function door_alone()
{
    const out = {door: '', told: [], said: []};
    const wall = await server_of(function (req, res) {
        out.told.push(req.headers['x-real-ip']);
        res.writeHead((req.headers.cookie === 'session=good') ? 200 : 401, {'x-auth-user': 'user@example.com'});
        res.end();
    });
    const echo = await server_of(function (req, res) {
        out.said.push(words_of(req));
        res.end('the page');
    });
    echo.on('upgrade', function (req, socket) {
        out.said.push(words_of(req));
        socket.end('HTTP/1.1 101 Switching Protocols\r\nconnection: upgrade\r\nupgrade: websocket\r\n\r\n');
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-door-alone-'));
    fs.mkdirSync(path.join(dir, 'doors'));
    fs.writeFileSync(path.join(dir, 'doors', 'table.json'), JSON.stringify({
        version: 'test',
        self: 'server',
        token: TOKEN_SERVER,
        names: {'walled.example.com': {service: 'echo', wall: 'authwall', off: false}, 'open.example.com': {service: 'echo', wall: null, off: false}},
        services: {
            authwall: {service: 'authwall', machine: 'server', kind: 'external', upstream: `127.0.0.1:${wall.address().port}`},
            echo: {service: 'echo', machine: 'server', kind: 'external', upstream: `127.0.0.1:${echo.address().port}`},
        },
        peers: {},
    }));
    const agent = agent_start(NOBODY_PORT, TOKEN_SERVER, {SERVICEMAN_AGENT_DIR: dir, SERVICEMAN_HTTP_SOCKET_MODE: '0600', SERVICEMAN_PEER_PORT: '0'});
    const lines = lines_of(agent);
    out.door = path.join(dir, 'http.sock');
    out.close = function () {
        agent.kill('SIGKILL');
        for (const server of [wall, echo]) {
            server.close();
            server.closeAllConnections();
        }
        fs.rmSync(dir, {recursive: true, force: true});
    };
    try {
        await wait_until(() => lines.join('').includes('[http_socket_begin]'), 5000);
    }
    catch (error) {
        out.close();
        throw error;
    }
    return out;
}

// Every header of a request that a stack may read as x-auth-user or as x-serviceman-relay
function words_of(req)
{
    const out = {};
    for (const name of Object.keys(req.headers)) {
        if (/^x[-_](auth[-_]user|serviceman[-_]relay)$/.test(name)) {
            out[name] = req.headers[name];
        }
    }
    return out;
}

function agent_start(control_port, token, env, extra)
{
    const argv = [AGENT, '--url', `http://127.0.0.1:${control_port}`, '--token', token].concat((extra === undefined) ? [] : extra);
    const out = child_process.spawn(process.execPath, argv, {stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, env)});
    out.stdout.resume();
    out.stderr.resume();
    return out;
}

// What an agent says on its stdout, gathered as it comes
function lines_of(agent)
{
    const out = [];
    agent.stdout.on('data', v => out.push(String(v)));
    return out;
}

function server_of(handler)
{
    const server = http.createServer(handler);
    return new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', function () {
            resolve(server);
        });
    });
}

function close_server(server)
{
    return new Promise(function (resolve) {
        server.close(resolve);
        server.closeAllConnections();
    });
}

function port_free()
{
    return new Promise(function (resolve) {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', function () {
            const port = server.address().port;
            server.close(function () {
                resolve(port);
            });
        });
    });
}

function fetch_socket(file, host, path_asked, headers)
{
    return new Promise(function (resolve, reject) {
        const request = http.request({socketPath: file, path: path_asked, headers: Object.assign({host}, headers)}, function (answer) {
            const body = [];
            answer.on('data', v => body.push(v));
            answer.on('end', () => resolve({status: answer.statusCode, headers: answer.headers, body: Buffer.concat(body).toString('utf8')}));
        });
        request.on('error', reject);
        request.end();
    });
}

// A websocket's handshake through a door: the status it was answered with
function shake_socket(file, host, headers)
{
    return new Promise(function (resolve, reject) {
        const request = http.request({socketPath: file, path: '/ws', headers: Object.assign({host, connection: 'upgrade', upgrade: 'websocket'}, headers)}, function (answer) {
            answer.resume();
            resolve(answer.statusCode);
        });
        request.on('upgrade', function (answer, socket) {
            socket.destroy();
            resolve(answer.statusCode);
        });
        request.on('error', reject);
        request.end();
    });
}

// {status, body}, or {status: 'closed'} for a connection that ended with no answer
function fetch_port(port, headers)
{
    return new Promise(function (resolve) {
        const request = http.request({host: '127.0.0.1', port, path: '/', headers}, function (answer) {
            const body = [];
            answer.on('data', v => body.push(v));
            answer.on('end', () => resolve({status: answer.statusCode, body: Buffer.concat(body).toString('utf8')}));
        });
        request.on('upgrade', function (answer, socket) {
            socket.destroy();
            resolve({status: answer.statusCode});
        });
        request.on('error', function () {
            resolve({status: 'closed'});
        });
        request.end();
    });
}

// Whether a port on 127.0.0.1 takes a connection yet
async function wait_until_listening(port, timeout_ms)
{
    const deadline = Date.now() + timeout_ms;
    while ((await connects('127.0.0.1', port)) === false) {
        if (Date.now() >= deadline) {
            throw new Error(`127.0.0.1:${port} never listened`);
        }
        await timers.setTimeout(25);
    }
}

function connects(host, port)
{
    return new Promise(function (resolve) {
        const socket = net.connect({host, port});
        socket.on('connect', function () {
            socket.destroy();
            resolve(true);
        });
        socket.on('error', function () {
            resolve(false);
        });
    });
}

// This machine's own addresses, the loopback left out
function addresses_not_loopback()
{
    return Object.values(os.networkInterfaces()).flat().filter(v => (v.internal === false) && (v.family === 'IPv4')).map(v => v.address);
}

async function wait_until(ready, timeout_ms)
{
    const deadline = Date.now() + timeout_ms;
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
