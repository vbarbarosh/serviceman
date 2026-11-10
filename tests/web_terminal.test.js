const assert = require('assert');
const fetch_host = require('./fetch_host');
const handshake_raw = require('./handshake_raw');
const server_make = require('../src/web-terminal/src/server_make');
const test = require('node:test');
const token_from_env = require('../src/web-terminal/src/token_from_env');
const ws = require('ws');

const TOKEN = 'wt_the-token-of-the-tests';

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
