const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const control_owner_token = require('../src/main/src/helpers/control_owner_token');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');

const TOKEN = '0123456789abcdef0123456789abcdef';
const TOKEN2 = 'fedcba9876543210fedcba9876543210';

test('the control door wants a token: none, or one nobody holds, gets the sign-in page or a 401; the owner\'s opens everything', async function (t) {
    const running = await serviceman_start(t);
    const none = await call(running, 'GET', '/api/v1/status', null, null);
    assert.deepStrictEqual([none.status, JSON.parse(none.body).error], [401, 'the control door wants a token: Authorization: Bearer <token>']);
    const page = await call(running, 'GET', '/', null, null, {accept: 'text/html'});
    assert.strictEqual(page.status, 401);
    assert.match(page.body, /Paste the owner's token/);
    assert.strictEqual((await call(running, 'GET', '/api/v1/status', null, 'sm_nobody')).status, 401);
    assert.strictEqual((await call(running, 'GET', '/api/v1/config', null, null)).status, 401);
    assert.strictEqual((await call(running, 'POST', '/api/v1/services/x/start', null, null)).status, 401);
    // The agent and its installer hold no secret and stay open
    assert.strictEqual((await call(running, 'GET', '/api/v1/agent.js', null, null)).status, 200);

    const owner = await call(running, 'GET', '/api/v1/status', null, running.owner);
    assert.strictEqual(owner.status, 200);
    assert.deepStrictEqual(JSON.parse(owner.body).remotes.map(v => v.name), ['vps1', 'vps2']);
    assert.strictEqual(running.app.log_lines.some(v => v.includes(running.owner)), false, 'no token is written in the log');
});

test('the page signs in once with the owner\'s token and gets a cookie; an agent\'s is not signed in; signing out ends it', async function (t) {
    const running = await serviceman_start(t);
    const wrong = await call(running, 'POST', '/api/v1/session', {token: 'sm_nobody'}, null);
    assert.deepStrictEqual([wrong.status, JSON.parse(wrong.body).error], [401, 'That is not the owner\'s token']);
    const signed = await call(running, 'POST', '/api/v1/session', {token: running.owner}, null, {host: 'serviceman.localhost'});
    assert.strictEqual(signed.status, 200);
    const cookie = signed.headers['set-cookie'][0];
    assert.match(cookie, /^serviceman_token=sm_[A-Za-z0-9_-]+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict; Domain=serviceman\.localhost$/);
    const pair = cookie.split(';')[0];
    assert.strictEqual((await call(running, 'GET', '/api/v1/status', null, null, {cookie: pair})).status, 200);
    assert.strictEqual((await call(running, 'GET', '/', null, null, {cookie: `other=1; ${pair}`, accept: 'text/html'})).status, 200);

    const reader = await token_make(running, {label: 'an agent', remotes: ['vps1'], rights: ['status']});
    const refused = await call(running, 'POST', '/api/v1/session', {token: reader.token}, null);
    assert.deepStrictEqual([refused.status, JSON.parse(refused.body).error], [401, 'An agent\'s token is sent with each request, not signed in']);
    const signed_out = await call(running, 'DELETE', '/api/v1/session', null, null);
    assert.match(signed_out.headers['set-cookie'][0], /^serviceman_token=; Path=\/; Max-Age=0;/);
});

test('an agent\'s token sees its machines alone, does only what it was given, and stops at once when taken back', async function (t) {
    const running = await serviceman_start(t);
    const bad = await call(running, 'POST', '/api/v1/tokens', {label: 'x', remotes: ['nowhere'], rights: ['status']}, running.owner);
    assert.deepStrictEqual([bad.status, JSON.parse(bad.body).error], [400, 'no remote named "nowhere"']);
    assert.strictEqual((await call(running, 'POST', '/api/v1/tokens', {label: 'x', remotes: ['vps1'], rights: ['shell']}, running.owner)).status, 400);
    assert.strictEqual((await call(running, 'POST', '/api/v1/tokens', {label: '', remotes: ['vps1'], rights: ['status']}, running.owner)).status, 400);
    const made = await token_make(running, {label: 'the notes agent', remotes: ['vps1'], rights: ['status', 'metrics']});
    assert.match(made.token, /^sm_[A-Za-z0-9_-]{43}$/);
    const kept = fs.readFileSync(path.join(running.app.state_dir, 'control_tokens.json'), 'utf8');
    assert.strictEqual(kept.includes(made.token), false, 'only a hash is kept');
    assert.strictEqual(fs.statSync(path.join(running.app.state_dir, 'control_tokens.json')).mode & 0o777, 0o600);

    // The status is its own: its machine, its rights, nothing of the config
    const status = JSON.parse((await call(running, 'GET', '/api/v1/status', null, made.token)).body);
    assert.deepStrictEqual(Object.keys(status).sort(), ['now', 'remotes', 'services', 'started_at', 'token']);
    assert.deepStrictEqual(status.remotes.map(v => v.name), ['vps1']);
    assert.deepStrictEqual(status.token, {label: 'the notes agent', remotes: ['vps1'], rights: ['status', 'metrics'], folders: []});
    assert.strictEqual(JSON.stringify(status).includes(TOKEN), false);

    // A read of its machine goes on to the route; another machine, another read, any write is refused
    const own = await call(running, 'GET', '/api/v1/remotes/vps1/metrics?range=1h', null, made.token);
    assert.strictEqual([401, 403].includes(own.status), false, `its own machine goes on to the route: ${own.status} ${own.body}`);
    const other = await call(running, 'GET', '/api/v1/remotes/vps2/metrics', null, made.token);
    assert.deepStrictEqual([other.status, JSON.parse(other.body).error], [403, 'the token "the notes agent" may not see vps2']);
    const read = await call(running, 'GET', '/api/v1/remotes/vps1/processes', null, made.token);
    assert.deepStrictEqual([read.status, JSON.parse(read.body).error], [403, 'the token "the notes agent" may not read the processes']);
    const terminals = await call(running, 'GET', '/api/v1/remotes/vps1/terminals', null, made.token);
    assert.deepStrictEqual([terminals.status, JSON.parse(terminals.body).error], [403, 'the token "the notes agent" may not use the terminals']);
    const files = await call(running, 'GET', '/api/v1/remotes/vps1/fs?path=/', null, made.token);
    assert.deepStrictEqual([files.status, JSON.parse(files.body).error], [403, 'the token "the notes agent" may not use the files']);
    for (const [method, asked] of [['GET', '/api/v1/config'], ['GET', '/api/v1/secrets'], ['GET', '/api/v1/tokens'], ['POST', '/api/v1/services/x/start'], ['POST', '/api/v1/tokens'], ['GET', '/api/v1/remotes/vps1/docker/containers/abc/fs?path=/'], ['POST', '/api/v1/transfers'], ['POST', '/api/v1/remotes/vps1/metrics'], ['GET', '/']]) {
        const answer = await call(running, method, asked, null, made.token);
        assert.deepStrictEqual([answer.status, JSON.parse(answer.body).error], [403, 'the token "the notes agent" has no right to this'], `${method} ${asked}`);
    }
    assert.strictEqual(running.app.log_lines.some(v => /\[control_token_used\] token="the notes agent" method=GET path=\/api\/v1\/status/.test(v)), true);
    assert.strictEqual(running.app.log_lines.some(v => v.includes(made.token)), false, 'no token is written in the log');

    // The list says when it was used; taken back, it stops at once
    const listed = JSON.parse((await call(running, 'GET', '/api/v1/tokens', null, running.owner)).body);
    assert.deepStrictEqual(listed.rights, ['status', 'metrics', 'processes', 'ports', 'disks', 'packages', 'containers', 'files', 'terminals']);
    assert.strictEqual(listed.tokens[0].sha256, undefined);
    assert.notStrictEqual(listed.tokens[0].used_at, null);
    assert.strictEqual((await call(running, 'DELETE', `/api/v1/tokens/${made.item.id}`, null, running.owner)).status, 200);
    assert.strictEqual((await call(running, 'GET', '/api/v1/status', null, made.token)).status, 401);
    assert.strictEqual((await call(running, 'DELETE', `/api/v1/tokens/${made.item.id}`, null, running.owner)).status, 404);
});

test('without SERVICEMAN_OWNER_TOKEN the owner\'s token is made once, kept in owner.token for nobody else, and kept across restarts', async function (t) {
    const given = process.env.SERVICEMAN_OWNER_TOKEN;
    delete process.env.SERVICEMAN_OWNER_TOKEN;
    t.after(function () {
        process.env.SERVICEMAN_OWNER_TOKEN = given;
    });
    const running = await serviceman_start(t);
    const file = path.join(running.app.state_dir, 'owner.token');
    const made = fs.readFileSync(file, 'utf8').trim();
    assert.match(made, /^sm_[A-Za-z0-9_-]{43}$/);
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
    assert.strictEqual((await call(running, 'GET', '/api/v1/status', null, made)).status, 200);
    assert.strictEqual((await call(running, 'GET', '/api/v1/status', null, given)).status, 401);
    const again = app_from_config(running.app.config);
    again.state_dir = running.app.state_dir;
    assert.strictEqual(control_owner_token(again), made);
});

test('a token with terminals uses the kept terminals of its machines and opens no other shell; the owner\'s opens any', async function (t) {
    const running = await serviceman_start(t);
    const reader = await token_make(running, {label: 'an agent', remotes: ['vps1'], rights: ['status']});
    const terminals = await token_make(running, {label: 'the notes app', remotes: ['vps1'], rights: ['terminals']});
    const term = '/api/v1/shell?remote=vps1&term=work';
    assert.strictEqual(await shell_answer(running, null, term), 'closed');
    assert.strictEqual(await shell_answer(running, reader.token, term), 'closed');
    assert.match(await shell_answer(running, terminals.token, term), /^HTTP\/1.1 101/);
    for (const other of ['/api/v1/shell?remote=vps2&term=work', '/api/v1/shell?remote=vps1', '/api/v1/shell?remote=vps1&term=work&container=abc', '/api/v1/shell?service=x&slot=1']) {
        assert.strictEqual(await shell_answer(running, terminals.token, other), 'closed', other);
    }
    assert.match(await shell_answer(running, running.owner, '/api/v1/shell?remote=vps1'), /^HTTP\/1.1 101/);
    assert.strictEqual(running.app.log_lines.some(v => /\[shell_refused\] .*token="the notes app" reason="may not see vps2"/.test(v)), true);

    // Its calls go on to the routes of its machine, the machine being away here; another's are refused
    for (const [method, asked] of [['GET', '/api/v1/remotes/vps1/terminals'], ['POST', '/api/v1/remotes/vps1/terminals'], ['POST', '/api/v1/remotes/vps1/terminals/work/end'], ['POST', '/api/v1/remotes/vps1/terminals/work/signal']]) {
        const answer = await call(running, method, asked, {name: 'work', signal: 'SIGINT'}, terminals.token);
        assert.strictEqual([401, 403].includes(answer.status), false, `${method} ${asked}: ${answer.status} ${answer.body}`);
    }
    const other = await call(running, 'POST', '/api/v1/remotes/vps2/terminals', {name: 'work'}, terminals.token);
    assert.deepStrictEqual([other.status, JSON.parse(other.body).error], [403, 'the token "the notes app" may not see vps2']);
    const status = await call(running, 'GET', '/api/v1/status', null, terminals.token);
    assert.deepStrictEqual([status.status, JSON.parse(status.body).error], [403, 'the token "the notes app" may not read the status']);
});

// A serviceman of its own state dir, so its owner's token and tokens are this test's alone
async function serviceman_start(t)
{
    const state_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-tokens-'));
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: TOKEN}, {name: 'vps2', token: TOKEN2}],
        services: [],
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
        fs.rmSync(state_dir, {recursive: true, force: true});
    });
    return {app, port: servers.control.address().port, owner: fetch_host.OWNER_TOKEN};
}

async function token_make(running, body)
{
    const answer = await call(running, 'POST', '/api/v1/tokens', body, running.owner);
    assert.strictEqual(answer.status, 200, answer.body);
    return JSON.parse(answer.body);
}

function call(running, method, asked, body, token, headers)
{
    const extra = Object.assign({}, headers);
    const host = ((extra.host === undefined) ? '127.0.0.1' : extra.host);
    delete extra.host;
    return fetch_host({port: running.port, host, method, path: asked, token, headers: extra, body: ((body === null) ? undefined : JSON.stringify(body))});
}

// The first line the shell door answers, or closed when it hangs up without a word
function shell_answer(running, token, asked)
{
    return new Promise(function (resolve) {
        const socket = net.connect(running.port, '127.0.0.1');
        let said = '';
        socket.on('connect', function () {
            const auth = ((token === null) ? '' : `Authorization: Bearer ${token}\r\n`);
            socket.write(`GET ${asked} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${auth}\r\n`);
        });
        socket.on('data', function (chunk) {
            said += chunk.toString('latin1');
            if (said.includes('\r\n')) {
                socket.destroy();
                resolve(said.split('\r\n')[0]);
            }
        });
        socket.on('close', () => resolve((said === '') ? 'closed' : said.split('\r\n')[0]));
        socket.on('error', () => resolve('closed'));
    });
}
