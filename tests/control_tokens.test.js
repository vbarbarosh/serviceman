const agent_signed = require('../src/helpers/agent_signed');
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
const stream_open = require('../src/main/src/helpers/stream_open');
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
    // The agent and its installer hold no secret and stay open; so do the host's signature of
    // the agent and the public key that checks it, which is what a machine takes an update by
    const agent = await call(running, 'GET', '/api/v1/agent.js', null, null);
    assert.strictEqual(agent.status, 200);
    const signature = await call(running, 'GET', '/api/v1/agent.js.sig', null, null);
    const key = await call(running, 'GET', '/api/v1/agent.pub', null, null);
    assert.deepStrictEqual([signature.status, key.status], [200, 200]);
    assert.strictEqual(agent_signed(agent.body, signature.body.trim(), key.body.trim()), true, 'the file served is the one signed');
    assert.strictEqual(agent_signed(`${agent.body} `, signature.body.trim(), key.body.trim()), false);
    assert.strictEqual(fs.statSync(path.join(running.app.state_dir, 'agent_sign.key')).mode & 0o777, 0o600, 'the host\'s key is its own');

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
    // Behind a TLS front the page came over https, and the cookie never travels over plain http
    const fronted = await call(running, 'POST', '/api/v1/session', {token: running.owner}, null, {host: 'serviceman.localhost', 'x-forwarded-proto': 'https'});
    assert.match(fronted.headers['set-cookie'][0], /; Domain=serviceman\.localhost; Secure$/);
    assert.strictEqual((await call(running, 'GET', '/api/v1/status', null, null, {cookie: pair})).status, 200);
    assert.strictEqual((await call(running, 'GET', '/', null, null, {cookie: `other=1; ${pair}`, accept: 'text/html'})).status, 200);

    const reader = await token_make(running, {label: 'an agent', remotes: ['vps1'], rights: ['status']});
    const refused = await call(running, 'POST', '/api/v1/session', {token: reader.token}, null);
    assert.deepStrictEqual([refused.status, JSON.parse(refused.body).error], [401, 'An agent\'s token is sent with each request, not signed in']);
    const signed_out = await call(running, 'DELETE', '/api/v1/session', null, null);
    assert.match(signed_out.headers['set-cookie'][0], /^serviceman_token=; Path=\/; Max-Age=0;/);
});

test('an agent\'s token sees its machines alone, does only what it was given, and stops at once when revoked', async function (t) {
    const running = await serviceman_start(t);
    const bad = await call(running, 'POST', '/api/v1/tokens', {label: 'x', remotes: ['nowhere'], rights: ['status']}, running.owner);
    assert.deepStrictEqual([bad.status, JSON.parse(bad.body).error], [400, 'no remote named "nowhere"']);
    assert.strictEqual((await call(running, 'POST', '/api/v1/tokens', {label: 'x', remotes: ['vps1'], rights: ['shell']}, running.owner)).status, 400);
    assert.strictEqual((await call(running, 'POST', '/api/v1/tokens', {label: '', remotes: ['vps1'], rights: ['status']}, running.owner)).status, 400);
    // A versions right kept to apps names app folders of the config; without that right the apps mean nothing
    const no_app = await call(running, 'POST', '/api/v1/tokens', {label: 'x', remotes: ['vps1'], rights: ['versions'], services: ['nowhere']}, running.owner);
    assert.deepStrictEqual([no_app.status, JSON.parse(no_app.body).error], [400, 'no app folder named "nowhere"']);
    const plain = await token_make(running, {label: 'plain', remotes: ['vps1'], rights: ['status'], services: ['nowhere']});
    assert.deepStrictEqual(plain.item.services, []);
    assert.strictEqual((await call(running, 'DELETE', `/api/v1/tokens/${plain.item.id}`, null, running.owner)).status, 200);
    const made = await token_make(running, {label: 'the notes agent', remotes: ['vps1'], rights: ['status', 'metrics']});
    assert.match(made.token, /^sm_[A-Za-z0-9_-]{43}$/);
    const kept = fs.readFileSync(path.join(running.app.state_dir, 'control_tokens.json'), 'utf8');
    assert.strictEqual(kept.includes(made.token), false, 'only a hash is kept');
    assert.strictEqual(fs.statSync(path.join(running.app.state_dir, 'control_tokens.json')).mode & 0o777, 0o600);

    // The status is its own: its machine, its rights, nothing of the config
    const status = JSON.parse((await call(running, 'GET', '/api/v1/status', null, made.token)).body);
    assert.deepStrictEqual(Object.keys(status).sort(), ['now', 'remotes', 'services', 'started_at', 'token']);
    assert.deepStrictEqual(status.remotes.map(v => v.name), ['vps1']);
    assert.deepStrictEqual(status.token, {label: 'the notes agent', remotes: ['vps1'], rights: ['status', 'metrics'], folders: [], services: []});
    assert.strictEqual(JSON.stringify(status).includes(TOKEN), false);

    // A read of its machine goes on to the route; another machine, another read, any write is refused
    const own = await call(running, 'GET', '/api/v1/remotes/vps1/metrics?range=1h', null, made.token);
    assert.strictEqual([401, 403].includes(own.status), false, `its own machine goes on to the route: ${own.status} ${own.body}`);
    const other = await call(running, 'GET', '/api/v1/remotes/vps2/metrics', null, made.token);
    assert.deepStrictEqual([other.status, JSON.parse(other.body).error], [403, 'the token "the notes agent" may not see vps2']);
    const uptime = await call(running, 'GET', '/api/v1/remotes/vps1/uptime', null, made.token);
    assert.strictEqual([401, 403].includes(uptime.status), false, `its uptime comes with the charts: ${uptime.status} ${uptime.body}`);
    const uptime_other = await call(running, 'GET', '/api/v1/remotes/vps2/uptime', null, made.token);
    assert.strictEqual(uptime_other.status, 403);
    const read = await call(running, 'GET', '/api/v1/remotes/vps1/processes', null, made.token);
    assert.deepStrictEqual([read.status, JSON.parse(read.body).error], [403, 'the token "the notes agent" may not read the processes']);
    const terminals = await call(running, 'GET', '/api/v1/remotes/vps1/terminals', null, made.token);
    assert.deepStrictEqual([terminals.status, JSON.parse(terminals.body).error], [403, 'the token "the notes agent" may not use the terminals']);
    const files = await call(running, 'GET', '/api/v1/remotes/vps1/fs?path=/', null, made.token);
    assert.deepStrictEqual([files.status, JSON.parse(files.body).error], [403, 'the token "the notes agent" may not use the files']);
    const version = await call(running, 'PUT', '/api/v1/services/x/zip', null, made.token);
    assert.deepStrictEqual([version.status, JSON.parse(version.body).error], [403, 'the token "the notes agent" may not send a new version of an app']);
    for (const [method, asked] of [['GET', '/api/v1/config'], ['GET', '/api/v1/secrets'], ['GET', '/api/v1/tokens'], ['POST', '/api/v1/services/x/start'], ['POST', '/api/v1/tokens'], ['GET', '/api/v1/remotes/vps1/docker/containers/abc/fs?path=/'], ['POST', '/api/v1/transfers'], ['POST', '/api/v1/remotes/vps1/metrics'], ['GET', '/']]) {
        const answer = await call(running, method, asked, null, made.token);
        assert.deepStrictEqual([answer.status, JSON.parse(answer.body).error], [403, 'the token "the notes agent" has no right to this'], `${method} ${asked}`);
    }
    assert.strictEqual(running.app.log_lines.some(v => /\[control_token_used\] token="the notes agent" method=GET path=\/api\/v1\/status/.test(v)), true);
    assert.strictEqual(running.app.log_lines.some(v => /\[control_token_used\] token="the notes agent" method=GET path=\/api\/v1\/remotes\/vps1\/metrics\?range=1h/.test(v)), true, 'what it asked for is kept');
    assert.strictEqual(running.app.log_lines.some(v => v.includes(made.token)), false, 'no token is written in the log');

    // The list says when it was used; revoked, it stops at once
    const listed = JSON.parse((await call(running, 'GET', '/api/v1/tokens', null, running.owner)).body);
    assert.deepStrictEqual(listed.rights, ['status', 'metrics', 'ports', 'versions', 'processes', 'disks', 'packages', 'containers', 'files', 'terminals']);
    assert.deepStrictEqual(listed.services, [], 'no app folder in this config');
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

test('a token is edited in place and goes on working; rotated, the old value is refused; every machine is every machine', async function (t) {
    const running = await serviceman_start(t);
    const made = await token_make(running, {label: 'visual-agency', remotes: ['vps1'], rights: ['files'], folders: ['~/wrong']});

    // Changed: the same token, its new rights from the next request
    assert.strictEqual((await call(running, 'GET', '/api/v1/status', null, made.token)).status, 403);
    const changed = await call(running, 'PUT', `/api/v1/tokens/${made.item.id}`, {label: 'visual-agency', remotes: ['vps1'], rights: ['files', 'status'], folders: ['~/visual-agency', '~/notes']}, running.owner);
    assert.strictEqual(changed.status, 200, changed.body);
    assert.deepStrictEqual(JSON.parse(changed.body).item.folders, ['~/visual-agency', '~/notes']);
    assert.strictEqual((await call(running, 'GET', '/api/v1/status', null, made.token)).status, 200);
    assert.strictEqual((await call(running, 'PUT', `/api/v1/tokens/${made.item.id}`, {label: '', remotes: [], rights: ['status']}, running.owner)).status, 400);
    assert.strictEqual((await call(running, 'PUT', '/api/v1/tokens/abcdef', {label: 'x', remotes: [], rights: ['status']}, running.owner)).status, 404);
    assert.strictEqual((await call(running, 'PUT', `/api/v1/tokens/${made.item.id}`, {label: 'x', remotes: [], rights: ['status']}, made.token)).status, 403, 'a token does not change itself');
    assert.strictEqual(running.app.log_lines.some(v => /\[control_token_changed\] .*folders=~\/visual-agency,~\/notes/.test(v)), true);

    // Rotated: the old value refused at once, the new one with the same rights
    const rotated = JSON.parse((await call(running, 'POST', `/api/v1/tokens/${made.item.id}/rotate`, null, running.owner)).body);
    assert.notStrictEqual(rotated.token, made.token);
    assert.strictEqual((await call(running, 'GET', '/api/v1/status', null, made.token)).status, 401);
    assert.strictEqual((await call(running, 'GET', '/api/v1/status', null, rotated.token)).status, 200);
    assert.deepStrictEqual([rotated.item.rights, rotated.item.folders], [['files', 'status'], ['~/visual-agency', '~/notes']]);

    // Every machine, those added later too
    const every = await token_make(running, {label: 'all', remotes: ['*', 'vps1'], rights: ['status', 'metrics']});
    assert.deepStrictEqual(every.item.remotes, ['*']);
    assert.deepStrictEqual(JSON.parse((await call(running, 'GET', '/api/v1/status', null, every.token)).body).remotes.map(v => v.name), ['vps1', 'vps2']);
    assert.notStrictEqual((await call(running, 'GET', '/api/v1/remotes/vps2/metrics?range=1h', null, every.token)).status, 403);

    // The page is told how a token is used here
    const listed = JSON.parse((await call(running, 'GET', '/api/v1/tokens', null, running.owner)).body);
    assert.deepStrictEqual([listed.socket, listed.port], [null, running.port]);
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

test('a terminal is joined once, through the stream its join answers, by whoever asked for it', async function (t) {
    const running = await serviceman_start(t);
    const notes = await token_make(running, {label: 'the notes app', remotes: ['vps1'], rights: ['terminals']});
    const other = await token_make(running, {label: 'another app', remotes: ['vps1'], rights: ['terminals']});
    function join_of(token) {
        return stream_open(running.app, {title: 'the terminal work on vps1', base: '/api/v1/remotes/vps1/terminals', command: 'join', item: 'work', token, join: {remote: 'vps1', term: 'work'}});
    }

    // Its own, once; another's token neither joins it nor uses it up
    const own = join_of(notes.item.id);
    assert.strictEqual(await shell_answer(running, other.token, own.url), 'closed');
    assert.strictEqual(await shell_answer(running, null, own.url), 'closed');
    assert.match(await shell_answer(running, notes.token, own.url), /^HTTP\/1.1 101/);
    assert.strictEqual(await shell_answer(running, notes.token, own.url), 'closed', 'a stream is joined once');
    assert.strictEqual(await shell_answer(running, running.owner, '/api/v1/streams/s_nope'), 'closed');
    assert.match(await shell_answer(running, running.owner, join_of(null).url), /^HTTP\/1.1 101/);
    assert.strictEqual(running.app.log_lines.some(v => /\[shell_refused\] .*token="another app" reason=not_its_stream/.test(v)), true);

    // One both ways is not read as lines; streams are the owner's to list and read
    const both = join_of(null);
    const read = await call(running, 'GET', both.url, null, running.owner);
    assert.deepStrictEqual([read.status, JSON.parse(read.body).error], [400, 'this stream goes both ways: it is joined over a WebSocket at this address']);
    for (const asked of ['/api/v1/streams', both.url]) {
        const refused = await call(running, 'GET', asked, null, notes.token);
        assert.strictEqual(refused.status, 403, asked);
    }

    // The join is a command of the Terminal module, under the terminals right: the machine is
    // away here, which is the answer
    const joined = await call(running, 'POST', '/api/v1/remotes/vps1/terminals/work/join', null, notes.token);
    assert.deepStrictEqual([joined.status, JSON.parse(joined.body).error], [409, 'vps1 is not connected']);
});

// A serviceman of its own state dir, so its owner's token and tokens are this test's alone
test('the modules say what they hold and do; a door none names is a 404, and a right is to the doors it names', async function (t) {
    const running = await serviceman_start(t);
    const listed = await call(running, 'GET', '/api/v1/modules', null, running.owner);
    assert.strictEqual(listed.status, 200);
    const modules = JSON.parse(listed.body).modules;
    assert.deepStrictEqual(modules.map(v => v.module), ['processes', 'disks', 'packages', 'docker', 'firewall', 'volumes', 'file_manager', 'terminal', 'file_manager']);
    const docker = modules.find(v => v.module === 'docker');
    assert.strictEqual(docker.base, '/api/v1/remotes/<name>/docker');
    assert.deepStrictEqual(docker.kinds.find(v => v.kind === 'containers').commands.map(v => v.command), ['start', 'stop', 'restart', 'remove']);

    // A door no manifest names is answered here, before the machine is looked for
    const none = await call(running, 'POST', '/api/v1/remotes/vps1/docker/containers/3f2a9c1b7d4e/kill', null, running.owner);
    assert.deepStrictEqual([none.status, JSON.parse(none.body).error], [404, 'no such door: /api/v1/remotes/vps1/docker/containers/3f2a9c1b7d4e/kill']);
    const named = await call(running, 'POST', '/api/v1/remotes/vps1/docker/containers/3f2a9c1b7d4e/stop', null, running.owner);
    assert.deepStrictEqual([named.status, JSON.parse(named.body).error], [409, 'vps1 is not connected']);

    // A token that reads the packages and the containers changes neither; the list is the owner's
    const made = await token_make(running, {label: 'the notes agent', remotes: ['vps1'], rights: ['packages', 'containers']});
    for (const [method, asked] of [['GET', '/api/v1/remotes/vps1/packages'], ['GET', '/api/v1/remotes/vps1/docker/containers']]) {
        const answer = await call(running, method, asked, null, made.token);
        assert.strictEqual([401, 403].includes(answer.status), false, `${method} ${asked}: ${answer.status} ${answer.body}`);
    }
    for (const [method, asked] of [['POST', '/api/v1/remotes/vps1/packages/upgrade'], ['GET', '/api/v1/remotes/vps1/packages/upgrade'], ['POST', '/api/v1/remotes/vps1/docker/containers/3f2a9c1b7d4e/stop'], ['GET', '/api/v1/modules']]) {
        const answer = await call(running, method, asked, null, made.token);
        assert.deepStrictEqual([answer.status, JSON.parse(answer.body).error], [403, 'the token "the notes agent" has no right to this'], `${method} ${asked}`);
    }
});

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
    const host = (extra.host === undefined) ? '127.0.0.1' : extra.host;
    delete extra.host;
    return fetch_host({port: running.port, host, method, path: asked, token, headers: extra, body: (body === null) ? undefined : JSON.stringify(body)});
}

// The first line the shell door answers, or closed when it hangs up without a word
function shell_answer(running, token, asked)
{
    return new Promise(function (resolve) {
        const socket = net.connect(running.port, '127.0.0.1');
        let said = '';
        socket.on('connect', function () {
            const auth = (token === null) ? '' : `Authorization: Bearer ${token}\r\n`;
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
