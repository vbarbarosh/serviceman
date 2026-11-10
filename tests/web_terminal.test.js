const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const handshake_raw = require('./handshake_raw');
const server_make = require('../src/web-terminal/src/server_make');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const token_from_env = require('../src/web-terminal/src/token_from_env');
const ws = require('ws');

const TOKEN = 'wt_the-token-of-the-tests';
// A pane's goodbye, a close frame: the door answers it and hangs up at once
const GOODBYE = Buffer.from([0x88, 0x80, 0x00, 0x00, 0x00, 0x00]);

// A terminal is a shell for whoever reaches it: the page, the sessions and the websocket want
// the token, the page's own files do not
test('the web terminal asks for its token: on the page as a cookie, from a program as a bearer, and on the websocket', async function (t) {
    const server = server_make(TOKEN);
    await new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', resolve);
    });
    t.after(function () {
        server.close();
        server.closeAllConnections();
    });
    const port = server.address().port;

    // Nothing without it but the sign-in form, and the page's files
    const page = await fetch_host({port, host: '127.0.0.1', path: '/', token: null});
    assert.strictEqual(page.status, 401);
    assert.match(page.body, /Paste the token/);
    const named = await fetch_host({port, host: '127.0.0.1', path: '/work', token: null});
    assert.strictEqual(named.status, 401);
    const listed = await fetch_host({port, host: '127.0.0.1', path: '/_/sessions', token: null});
    assert.deepStrictEqual([listed.status, JSON.parse(listed.body).error], [401, 'the token goes as Authorization: Bearer <token>, or once on the page']);
    const script = await fetch_host({port, host: '127.0.0.1', path: '/_/app/web_terminal.js', token: null});
    assert.strictEqual(script.status, 200);
    assert.strictEqual(await shell_answer(port, {}), 'HTTP/1.1 401 Unauthorized');
    assert.strictEqual(await shell_answer(port, {authorization: 'Bearer wt_nobody'}), 'HTTP/1.1 401 Unauthorized');

    // The token once, for a cookie; a wrong one is refused
    const wrong = await fetch_host({port, host: '127.0.0.1', path: '/_/session', method: 'POST', body: JSON.stringify({token: 'wt_nobody'}), token: null});
    assert.deepStrictEqual([wrong.status, JSON.parse(wrong.body).error], [401, 'That is not the token']);
    const signed = await fetch_host({port, host: '127.0.0.1', path: '/_/session', method: 'POST', body: JSON.stringify({token: TOKEN}), token: null});
    assert.strictEqual(signed.status, 200);
    const cookie = signed.headers['set-cookie'][0];
    assert.match(cookie, /^web_terminal_token=wt_the-token-of-the-tests; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict$/);
    const fronted = await fetch_host({port, host: '127.0.0.1', path: '/_/session', method: 'POST', body: JSON.stringify({token: TOKEN}), token: null, headers: {'x-forwarded-proto': 'https'}});
    assert.match(fronted.headers['set-cookie'][0], /; Secure$/);
    const pair = cookie.split(';')[0];

    // With it: the page, the sessions, the websocket, as a cookie or as a bearer
    const opened = await fetch_host({port, host: '127.0.0.1', path: '/', token: null, headers: {cookie: `theme=dark; ${pair}`}});
    assert.strictEqual(opened.status, 200);
    assert.match(opened.body, /<title>Terminal<\/title>/);
    const sessions = await fetch_host({port, host: '127.0.0.1', path: '/_/sessions', token: TOKEN});
    assert.strictEqual(sessions.status, 200);
    assert.ok(Array.isArray(JSON.parse(sessions.body).sessions));
    assert.strictEqual(await shell_answer(port, {cookie: pair}), 'HTTP/1.1 101 Switching Protocols');
});

// With the token, at a name no session can have: the door opens, says so and closes, and no
// shell is started for the test
test('a pane that breaks the websocket\'s rules is cut alone, and the web terminal goes on', async function (t) {
    const server = server_make(TOKEN);
    await new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', resolve);
    });
    t.after(function () {
        server.close();
        server.closeAllConnections();
    });
    const port = server.address().port;
    const frame = Buffer.from([0xf1, 0x80, 0x01, 0x02, 0x03, 0x04]);
    const said = await handshake_raw({port, host: '127.0.0.1', target: '/NO-SUCH-NAME', headers: {Authorization: `Bearer ${TOKEN}`}, frame});
    assert.match(said, / 101 /);
    const after = await fetch_host({port, host: '127.0.0.1', path: '/_/sessions', token: TOKEN});
    assert.strictEqual(after.status, 200);
});

// `//` reads as a host with no name: no address at all. The page's door reads the address
// before it looks at the token, the websocket's door after: so the first takes no token
test('an address that is no address is refused at both doors, and the web terminal goes on', async function (t) {
    const server = server_make(TOKEN);
    await new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', resolve);
    });
    t.after(function () {
        server.close();
        server.closeAllConnections();
    });
    const port = server.address().port;
    const asked = await fetch_host({port, host: '127.0.0.1', path: '//', token: null});
    assert.deepStrictEqual([asked.status, asked.body], [400, 'bad request\n']);
    assert.strictEqual(await handshake_raw({port, host: '127.0.0.1', target: '//', headers: {Authorization: `Bearer ${TOKEN}`}}), 'closed');
    const after = await fetch_host({port, host: '127.0.0.1', path: '/', token: null});
    assert.strictEqual(after.status, 401);
});

// The 401 is written to whoever sent the handshake, and that one may be gone already: a reset
// right behind the handshake makes the write an error on a socket of the door's own
test('a handshake with no token that is reset before its answer costs its socket alone, and the web terminal goes on', async function (t) {
    const server = server_make(TOKEN);
    await new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', resolve);
    });
    t.after(function () {
        server.close();
        server.closeAllConnections();
    });
    const port = server.address().port;
    for (let i = 0; i < 8; i++) {
        assert.strictEqual(await handshake_raw({port, host: '127.0.0.1', target: '/', reset: true}), 'closed');
    }
    const after = await fetch_host({port, host: '127.0.0.1', path: '/', token: null});
    assert.strictEqual(after.status, 401);
});

// The cookie is the browser's, and a browser sends it with a handshake from any page of the
// same site: a service on a neighbouring name, another port of the same host. The page that
// asks is named in Origin, and only the terminal's own gets a terminal.
test('a page of another origin opens no terminal though the browser brings the cookie, and the web terminal goes on', async function (t) {
    const server = server_make(TOKEN);
    await new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', resolve);
    });
    t.after(function () {
        server.close();
        server.closeAllConnections();
    });
    const port = server.address().port;
    const cookie = `web_terminal_token=${TOKEN}`;

    // A service on a neighbouring name, in the browser of whoever signed in to the terminal
    assert.strictEqual(await door_answer(port, 'term.example.com', {Origin: 'https://blog.example.com'}), 'HTTP/1.1 401 Unauthorized');
    assert.strictEqual(await door_answer(port, 'term.example.com', {Origin: 'https://blog.example.com', Cookie: cookie}), 'HTTP/1.1 403 Forbidden');
    // Another port of the same host; a name that only begins alike, or stands before an @;
    // then what is no address: a page from a file or a sandboxed frame says null, and a
    // program writes anything
    const foreign = [
        {host: `localhost:${port}`, origin: 'http://localhost:5173'},
        {host: 'term.example.com', origin: 'https://term.example.com:8443'},
        {host: 'term.example.com:8443', origin: 'https://term.example.com'},
        {host: 'term.example.com', origin: 'https://term.example.com.blog.example.com'},
        {host: 'term.example.com', origin: 'https://term.example.com@blog.example.com'},
        {host: 'term.example.com', origin: 'null'},
        {host: 'term.example.com', origin: 'file://'},
        {host: 'term.example.com', origin: 'https://'},
        {host: 'term.example.com', origin: 'no address at all'},
        {host: 'term.example.com', origin: ''},
    ];
    for (const item of foreign) {
        assert.strictEqual(await door_answer(port, item.host, {Origin: item.origin, Cookie: cookie}), 'HTTP/1.1 403 Forbidden', `${item.origin} at ${item.host}`);
    }
    // The token as a bearer changes nothing: a program that holds it names no origin
    assert.strictEqual(await door_answer(port, 'term.example.com', {Origin: 'https://blog.example.com', Authorization: `Bearer ${TOKEN}`}), 'HTTP/1.1 403 Forbidden');
    // The 403 is written to whoever asked, and that one may be gone already
    for (let i = 0; i < 8; i++) {
        assert.strictEqual(await handshake_raw({port, host: 'term.example.com', target: '/NO-SUCH-NAME', headers: {Origin: 'https://blog.example.com', Cookie: cookie}, reset: true}), 'closed');
    }

    // The terminal's own page opens it as before: on a plain port; behind serviceman on a
    // name, where https ended before this server and Host has no port, the front's, or the
    // usual one spelled out; in other letters; and a program, which names no origin
    const own = [
        {host: `localhost:${port}`, origin: `http://localhost:${port}`},
        {host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`},
        {host: '[::1]:3000', origin: 'http://[::1]:3000'},
        {host: 'term.example.com', origin: 'https://term.example.com'},
        {host: 'term.example.com:8443', origin: 'https://term.example.com:8443'},
        {host: 'term.example.com:443', origin: 'https://term.example.com'},
        {host: 'TERM.Example.COM', origin: 'https://term.example.com'},
        {host: 'term.example.com', origin: 'HTTPS://Term.Example.Com'},
    ];
    for (const item of own) {
        assert.strictEqual(await door_answer(port, item.host, {Origin: item.origin, Cookie: cookie}), 'HTTP/1.1 101 Switching Protocols', `${item.origin} at ${item.host}`);
    }
    assert.strictEqual(await door_answer(port, 'term.example.com', {Authorization: `Bearer ${TOKEN}`}), 'HTTP/1.1 101 Switching Protocols');
    const after = await fetch_host({port, host: 'term.example.com', path: '/_/sessions', token: TOKEN});
    assert.strictEqual(after.status, 200);
});

// Published by serviceman under a name of its own, the terminal is sent the Host and the
// Origin the browser wrote: the proxy passes both on as they came. So its own page opens it
// there, by the name alone or with serviceman's port, and a neighbouring service's page does
// not. serviceman hangs up on an answer that is no upgrade, the 403 as the 401.
test('behind serviceman the terminal\'s own page opens it, and the page of a neighbouring service does not', async function (t) {
    const server = server_make(TOKEN);
    await new Promise(function (resolve) {
        server.listen(0, '127.0.0.1', resolve);
    });
    t.after(function () {
        server.close();
        server.closeAllConnections();
    });
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        services: [{name: 'term', type: 'external', publish: {host: 'term.example.com'}, upstream: `127.0.0.1:${server.address().port}`}],
    }, __dirname);
    const servers = await server_start(app_from_config(config));
    t.after(function () {
        for (const item of [servers.server, servers.control]) {
            item.close();
            item.closeAllConnections();
        }
    });
    const port = servers.server.address().port;
    const cookie = `web_terminal_token=${TOKEN}`;
    assert.strictEqual(await door_answer(port, 'term.example.com', {Origin: 'https://term.example.com', Cookie: cookie}), 'HTTP/1.1 101 Switching Protocols');
    assert.strictEqual(await door_answer(port, `term.example.com:${port}`, {Origin: `http://term.example.com:${port}`, Cookie: cookie}), 'HTTP/1.1 101 Switching Protocols');
    assert.strictEqual(await door_answer(port, 'term.example.com', {Origin: 'https://blog.example.com', Cookie: cookie}), 'closed');
    assert.strictEqual(await door_answer(port, 'term.example.com', {Origin: 'https://blog.example.com'}), 'closed');
    assert.strictEqual(await door_answer(port, 'term.example.com', {Origin: 'https://term.example.com', Cookie: cookie}), 'HTTP/1.1 101 Switching Protocols');
});

test('the token comes from the environment, or is made and said once', function () {
    const said = [];
    assert.strictEqual(token_from_env({WEB_TERMINAL_TOKEN: ' wt_given '}, v => said.push(v)), 'wt_given');
    assert.deepStrictEqual(said, []);
    const made = token_from_env({}, v => said.push(v));
    assert.match(made, /^wt_[A-Za-z0-9_-]{43}$/);
    assert.strictEqual(said.length, 1);
    assert.ok(said[0].includes(made));
    assert.notStrictEqual(token_from_env({}, function () {}), made);
});

// The first line the websocket door answers a handshake sent to this Host with these headers,
// or `closed`. It asks for a name no session can have and says goodbye the moment the door
// opens, so an open door starts no shell and hangs up at once.
function door_answer(port, host, headers)
{
    return handshake_raw({port, host, target: '/NO-SUCH-NAME', headers, frame: GOODBYE});
}

// The first line the websocket door answers a handshake with these headers
function shell_answer(port, headers)
{
    return new Promise(function (resolve) {
        const client = new ws.WebSocket(`ws://127.0.0.1:${port}/`, {headers});
        client.on('upgrade', function (answer) {
            resolve(`HTTP/1.1 ${answer.statusCode} ${answer.statusMessage}`);
            client.terminate();
        });
        client.on('unexpected-response', function (req, answer) {
            resolve(`HTTP/1.1 ${answer.statusCode} ${answer.statusMessage}`);
            req.destroy();
        });
        client.on('error', function (error) {
            resolve(error.message);
        });
    });
}
