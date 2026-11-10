const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const ws = require('ws');

const WS = 'Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n';
const TOKEN = 'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3';
// How long an answer is waited for; a handshake that went through stays open past this
const ANSWER_MS = 800;

// A websocket handshake that came in through a machine's door is held to the door's rules as a
// request is: the name's service, behind its wall, with whatever the visitor claimed in
// x-auth-user dropped; a name the door was not given, one set aside, and the control page get
// nothing, however the control is exposed
test('a websocket through a machine\'s door reaches the service its rule names, past the wall, and nothing else', async function (t) {
    const echo = await echo_start();
    const wall = await wall_start();
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-door-ws-'));
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0, exposed: true},
        remotes: [{name: 'vps1', token: TOKEN, inbound: {'open.example.com': 'echo', 'walled.example.com': {service: 'echo', auth: 'wall'}, 'off.example.com': {service: 'echo', off: true}}}],
        services: [
            {name: 'echo', type: 'external', publish: {host: 'echo.localhost'}, upstream: `127.0.0.1:${echo.port}`},
            {name: 'wall', type: 'external', publish: {host: 'wall.localhost'}, upstream: `127.0.0.1:${wall.port}`},
        ],
    }, __dirname);
    const app = app_from_config(config);
    app.state_dir = state_dir;
    const servers = await server_start(app);
    t.after(function () {
        for (const door of [servers.server, servers.control, servers.socket]) {
            if ((door !== null) && (door !== undefined)) {
                door.close();
                door.closeAllConnections();
            }
        }
        echo.close();
        wall.close();
        fs.rmSync(state_dir, {recursive: true, force: true});
    });

    // The service's own published name is not the door's: nothing, and the log says so
    assert.match(await through(app, `GET /ws HTTP/1.1\r\nHost: echo.localhost\r\n${WS}x-auth-user: forged@example.com\r\n\r\n`), /^HTTP\/1\.1 404/);
    assert.deepStrictEqual(echo.users, []);
    // The door's name: through, and the visitor's x-auth-user is not the service's to see
    assert.match(await through(app, `GET /ws HTTP/1.1\r\nHost: open.example.com\r\n${WS}x-auth-user: forged@example.com\r\n\r\n`), /^HTTP\/1\.1 101/);
    assert.deepStrictEqual(echo.users, ['']);
    // A name behind a wall: the wall is asked first, and its word is what the service reads
    assert.match(await through(app, `GET /ws HTTP/1.1\r\nHost: walled.example.com\r\n${WS}x-auth-user: forged@example.com\r\n\r\n`), /^HTTP\/1\.1 401/);
    assert.match(await through(app, `GET /ws HTTP/1.1\r\nHost: walled.example.com\r\n${WS}Cookie: session=good\r\nx-auth-user: forged@example.com\r\n\r\n`), /^HTTP\/1\.1 101/);
    assert.deepStrictEqual(echo.users, ['', 'user@example.com']);
    // A name set aside
    assert.match(await through(app, `GET /ws HTTP/1.1\r\nHost: off.example.com\r\n${WS}\r\n`), /^HTTP\/1\.1 404/);
    // The control page's doors, with the owner's token and the control exposed: not through a
    // machine's door, a name no door was given, though from this host's own door they answer
    const owner = `Authorization: Bearer ${fetch_host.OWNER_TOKEN}\r\n`;
    assert.match(await through(app, `GET /api/v1/shell?service=echo HTTP/1.1\r\nHost: serviceman.localhost\r\n${WS}${owner}\r\n`), /^HTTP\/1\.1 404/);
    assert.match(await through(app, `GET /api/v1/remote HTTP/1.1\r\nHost: serviceman.localhost\r\nUpgrade: serviceman\r\nConnection: Upgrade\r\nAuthorization: Bearer ${TOKEN}\r\n\r\n`), /^HTTP\/1\.1 404/);
    assert.match(await direct(servers.server, `GET /api/v1/shell?service=echo HTTP/1.1\r\nHost: serviceman.localhost\r\n${WS}${owner}\r\n`), /^HTTP\/1\.1 101/);
    // A plain request through the door is read the same way as before
    assert.match(await through(app, 'GET /page HTTP/1.1\r\nHost: open.example.com\r\n\r\n'), /^HTTP\/1\.1 200/);
    assert.match(await through(app, 'GET /page HTTP/1.1\r\nHost: echo.localhost\r\n\r\n'), /^HTTP\/1\.1 404/);
    assert.ok(app.log_lines.some(v => /\[inbound_refused\] remote=vps1 host=echo\.localhost upgrade=websocket/.test(v)), 'the refusal is logged');
    assert.ok(app.log_lines.some(v => /\[inbound_refused\] remote=vps1 host=off\.example\.com upgrade=websocket off=true/.test(v)));
    assert.ok(app.log_lines.some(v => /\[wall_refused\] wall=wall host=walled\.example\.com/.test(v)));
});

// A service answers on its own address too, and nobody stands in front of it there: whatever a
// visitor writes into x-auth-user is dropped from a request and from a handshake alike, under
// either spelling a stack behind may read as that name, sent once, twice or as a list. Behind a
// wall the service reads the wall's word, and nothing of the visitor's beside it.
test('a visitor\'s x-auth-user never reaches a service, on its own address or through a machine\'s door', async function (t) {
    const echo = await echo_start();
    const wall = await wall_start();
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-door-claim-'));
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: TOKEN, inbound: {'open.example.com': 'echo', 'walled.example.com': {service: 'echo', auth: 'wall'}}}],
        services: [
            {name: 'echo', type: 'external', publish: {host: 'echo.localhost'}, upstream: `127.0.0.1:${echo.port}`},
            {name: 'wall', type: 'external', publish: {host: 'wall.localhost'}, upstream: `127.0.0.1:${wall.port}`},
        ],
    }, __dirname);
    const app = app_from_config(config);
    app.state_dir = state_dir;
    const servers = await server_start(app);
    t.after(function () {
        for (const door of [servers.server, servers.control]) {
            door.close();
            door.closeAllConnections();
        }
        echo.close();
        wall.close();
        fs.rmSync(state_dir, {recursive: true, force: true});
    });
    const claim = 'X-Auth-User: owner@example.com\r\nx-auth-user: root@example.com\r\nX_Auth_User: owner@example.com, root@example.com\r\n';

    // The service's own address, at this host's service port: a request, then a handshake
    assert.match(await direct(servers.server, `GET /page HTTP/1.1\r\nHost: echo.localhost\r\nConnection: close\r\n${claim}\r\n`), /^HTTP\/1\.1 200/);
    assert.match(await direct(servers.server, `GET /ws HTTP/1.1\r\nHost: echo.localhost\r\n${WS}${claim}\r\n`), /^HTTP\/1\.1 101/);
    assert.deepStrictEqual(echo.claims, [{}, {}]);
    // A door's name with no wall: nobody said who the visitor is, so the service is told nothing
    assert.match(await through(app, `GET /page HTTP/1.1\r\nHost: open.example.com\r\nConnection: close\r\n${claim}\r\n`), /^HTTP\/1\.1 200/);
    assert.deepStrictEqual(echo.claims.slice(2), [{}]);
    // Behind the wall: its word alone, in a request and in a handshake
    assert.match(await through(app, `GET /page HTTP/1.1\r\nHost: walled.example.com\r\nConnection: close\r\nCookie: session=good\r\n${claim}\r\n`), /^HTTP\/1\.1 200/);
    assert.match(await through(app, `GET /ws HTTP/1.1\r\nHost: walled.example.com\r\n${WS}Cookie: session=good\r\n${claim}\r\n`), /^HTTP\/1\.1 101/);
    assert.deepStrictEqual(echo.claims.slice(3), [{'x-auth-user': 'user@example.com'}, {'x-auth-user': 'user@example.com'}]);
});

// One request on a stream that came in through vps1's door: the first line of the answer, or
// '' when the far end closed without one
async function through(app, request)
{
    const pair = await socket_pair();
    pair.server.tunnel_from = 'vps1';
    app.servers.server.emit('connection', pair.server);
    const answer = await exchange(pair.client, request);
    pair.client.destroy();
    return answer.split('\r\n')[0];
}

// The same request at this host's own service door
async function direct(server, request)
{
    const client = net.connect(server.address().port, '127.0.0.1');
    await new Promise(function (resolve) {
        client.once('connect', resolve);
    });
    const answer = await exchange(client, request);
    client.destroy();
    return answer.split('\r\n')[0];
}

function exchange(client, request)
{
    return new Promise(function (resolve) {
        const chunks = [];
        function done() {
            resolve(Buffer.concat(chunks).toString('utf8'));
        }
        client.on('data', v => chunks.push(v));
        client.on('close', done);
        client.on('error', done);
        setTimeout(done, ANSWER_MS);
        client.write(request);
    });
}

function socket_pair()
{
    return new Promise(function (resolve) {
        let client = null;
        const server = net.createServer(function (socket) {
            server.close();
            resolve({server: socket, client});
        });
        server.listen(0, '127.0.0.1', function () {
            client = net.connect(server.address().port, '127.0.0.1');
        });
    });
}

// A service with a websocket, as a web terminal is: who it was told the visitor is, per
// handshake, and a page for a plain request; `claims` has, per request and per handshake, every
// header it was sent that a stack may read as x-auth-user
function echo_start()
{
    const echo = {port: 0, users: [], claims: []};
    const server = http.createServer(function (req, res) {
        echo.claims.push(claims_of(req));
        res.end('the page');
    });
    const sockets = new ws.WebSocketServer({server});
    sockets.on('connection', function (client, req) {
        echo.users.push((req.headers['x-auth-user'] === undefined) ? '' : String(req.headers['x-auth-user']));
        echo.claims.push(claims_of(req));
        client.on('message', v => client.send(`echo ${v}`));
    });
    echo.close = function () {
        sockets.close();
        server.close();
        server.closeAllConnections();
    };
    return new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', function () {
            echo.port = server.address().port;
            resolve(echo);
        });
    });
}

// Every header of a request that a stack may read as x-auth-user: CGI, WSGI and PHP hand a
// program `_` and `-` in a header's name as one
function claims_of(req)
{
    const out = {};
    for (const name of Object.keys(req.headers)) {
        if (/^x[-_]auth[-_]user$/.test(name)) {
            out[name] = req.headers[name];
        }
    }
    return out;
}

// The wall: a cookie it knows is a yes, and says who; anything else is a no
function wall_start()
{
    const wall = {port: 0};
    const server = http.createServer(function (req, res) {
        if ((req.url === '/auth/sidecar') && (req.headers.cookie === 'session=good')) {
            res.writeHead(200, {'x-auth-user': 'user@example.com'});
        }
        else {
            res.writeHead(401);
        }
        res.end();
    });
    wall.close = function () {
        server.close();
        server.closeAllConnections();
    };
    return new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', function () {
            wall.port = server.address().port;
            resolve(wall);
        });
    });
}
