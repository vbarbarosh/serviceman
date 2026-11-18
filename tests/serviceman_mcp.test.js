const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const http = require('http');
const mcp_bundle = require('../src/mcp/bundler/mcp_bundle');
const os = require('os');
const package_json = require('../package.json');
const path = require('path');
const profile_from_db = require('../src/main/src/helpers/profile_from_db');
const readline = require('readline');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');

const MCP = path.join(__dirname, '..', 'bin', 'serviceman-mcp');
const HELLO = {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'a box', version: '1.0.0'}};

// An agent in a box makes an app, sends it with app_send and comes back with its link; it
// changes the app and sends it again under the same name, and the same link answers the new
// version. serviceman runs here with its control door on a socket, as a box has it mounted,
// and the agent's token may send apps and nothing more.
test('app_send puts a folder on serviceman at a link, and a new version at the same link', async function (t) {
    const running = await serviceman_start(t);
    const notes = path.join(running.dir, 'notes');
    fs.mkdirSync(path.join(notes, 'guide'), {recursive: true});
    fs.writeFileSync(path.join(notes, 'index.html'), '<title>Notes 1</title>');
    fs.writeFileSync(path.join(notes, 'app.js'), 'console.log(1);');
    fs.writeFileSync(path.join(notes, 'guide', 'index.html'), '<title>Guide</title>');
    const mcp = mcp_start(t, running, await token_make(running, 'a box', ['apps']));

    const hello = await mcp.call('initialize', HELLO);
    assert.strictEqual(hello.result.protocolVersion, '2025-06-18', 'the version the client asked for, which is spoken here');
    assert.deepStrictEqual(hello.result.capabilities, {tools: {}});
    assert.strictEqual(hello.result.serverInfo.name, 'serviceman');
    mcp.notify('notifications/initialized');
    assert.deepStrictEqual((await mcp.call('ping', {})).result, {});
    const listed = await mcp.call('tools/list', {});
    assert.deepStrictEqual(listed.result.tools.map(v => v.name), ['app_send']);
    assert.deepStrictEqual(listed.result.tools[0].inputSchema.required, ['name', 'dir']);
    assert.match(listed.result.tools[0].description, /The whole folder goes/, 'the agent is told what is sent');

    const made = await mcp.call('tools/call', {name: 'app_send', arguments: {name: 'notes', dir: notes}});
    const made_text = made.result.content[0].text;
    assert.strictEqual(made.result.isError, false, made_text);
    assert.match(made_text, /^notes is a new app on serviceman, of 3 files\./);
    assert.ok(made_text.includes(`\nLink: http://notes.localhost:${running.port}/ (it opens in a browser on the computer serviceman runs on)\n`), made_text);
    assert.ok(made_text.includes('\nNo name outside: serviceman has no apps domain.'), made_text);
    assert.strictEqual((await fetch_host({port: running.port, host: 'notes.localhost', path: '/'})).body, '<title>Notes 1</title>');
    assert.strictEqual((await fetch_host({port: running.port, host: 'notes.localhost', path: '/guide/index.html'})).body, '<title>Guide</title>');
    assert.strictEqual((await fetch_host({port: running.port, host: 'notes.localhost', path: '/app.js'})).body, 'console.log(1);');

    // The new version by a path relative to where the agent started the server; a repository's
    // history and a file of secrets beside it are left out, and said so, at any depth
    fs.writeFileSync(path.join(notes, 'index.html'), '<title>Notes 2</title>');
    fs.rmSync(path.join(notes, 'app.js'));
    fs.mkdirSync(path.join(notes, '.git'));
    fs.writeFileSync(path.join(notes, '.git', 'config'), '[core]');
    fs.writeFileSync(path.join(notes, '.env'), 'TOKEN=secret');
    fs.writeFileSync(path.join(notes, 'guide', '.env.local'), 'TOKEN=secret');
    const again = await mcp.call('tools/call', {name: 'app_send', arguments: {name: 'notes', dir: 'notes'}});
    const again_text = again.result.content[0].text;
    assert.strictEqual(again.result.isError, false, again_text);
    assert.match(again_text, /^notes has a new version on serviceman, of 2 files; the version before it is gone, and its link is the same\./);
    assert.ok(again_text.includes(`\nLink: http://notes.localhost:${running.port}/ `), again_text);
    assert.strictEqual((await fetch_host({port: running.port, host: 'notes.localhost', path: '/'})).body, '<title>Notes 2</title>');
    assert.strictEqual((await fetch_host({port: running.port, host: 'notes.localhost', path: '/app.js'})).status, 404, 'the version before went whole');
    assert.ok(again_text.endsWith('\nLeft out, never sent: .env, .git/, guide/.env.local.'), again_text);
    for (const sent of ['/.env', '/.git/config', '/guide/.env.local']) {
        assert.notStrictEqual((await fetch_host({port: running.port, host: 'notes.localhost', path: sent})).body, (sent === '/.git/config') ? '[core]' : 'TOKEN=secret', `${sent} never sent`);
    }
    assert.strictEqual(await mcp.end(), 0, 'it ends with its client');
});

// What is not taken is said, for the agent to mend: serviceman's own words for a folder with no
// index.html and for a token that may not send apps, the tool's own for a link, which is never
// followed out of the folder; and nothing is made of any of them
test('app_send says why an app was not taken, in serviceman\'s words', async function (t) {
    const running = await serviceman_start(t);
    const mcp = mcp_start(t, running, await token_make(running, 'a box', ['apps']));
    await mcp.call('initialize', HELLO);
    const readme = path.join(running.dir, 'readme');
    fs.mkdirSync(readme);
    fs.writeFileSync(path.join(readme, 'readme.txt'), 'hello');
    const no_page = await mcp.call('tools/call', {name: 'app_send', arguments: {name: 'notes', dir: readme}});
    assert.strictEqual(no_page.result.isError, true);
    assert.match(no_page.result.content[0].text, /^serviceman answered 400: notes\.zip has no index\.html, at its top or in its one folder: a page starts with it\.$/);

    const linked = path.join(running.dir, 'linked');
    fs.mkdirSync(linked);
    fs.writeFileSync(path.join(linked, 'index.html'), '<title>Linked</title>');
    fs.symlinkSync(path.join(running.dir, 'serviceman.json'), path.join(linked, 'config.json'));
    const link = await mcp.call('tools/call', {name: 'app_send', arguments: {name: 'notes', dir: linked}});
    assert.deepStrictEqual(link.result, {content: [{type: 'text', text: 'config.json is a link, and links are not sent: put the file it points at in its place'}], isError: true});
    const nowhere = await mcp.call('tools/call', {name: 'app_send', arguments: {name: 'notes', dir: path.join(running.dir, 'nowhere')}});
    assert.deepStrictEqual([nowhere.result.isError, nowhere.result.content[0].text], [true, `${path.join(running.dir, 'nowhere')}: there is no such folder`]);
    const unknown = await mcp.call('tools/call', {name: 'app_list', arguments: {}});
    assert.strictEqual(unknown.error.code, -32602, 'a tool that is not here is an error of the call');

    const reader = mcp_start(t, running, await token_make(running, 'a reader', ['status']));
    const refused = await reader.call('tools/call', {name: 'app_send', arguments: {name: 'notes', dir: path.join(running.dir, 'readme')}});
    assert.deepStrictEqual([refused.result.isError, refused.result.content[0].text], [true, 'serviceman answered 403: the token "a reader" may not send an app of files']);
    assert.strictEqual(running.app.service_by_name.notes, undefined, 'no app was made');
});

// A box has node, serviceman's control socket and a token, and nothing of serviceman's repo: it
// takes serviceman-mcp as one file through the socket, with no token, since the file is public
// code, and runs it from a folder of its own with nothing in its environment but the token and
// the socket. That file alone answers as the checkout does, and sends an app.
test('serviceman-mcp is served as one file to anyone, and that file alone sends an app', async function (t) {
    const running = await serviceman_start(t);
    const answer = await socket_get(running.socket, '/api/v1/serviceman-mcp.js');
    assert.strictEqual(answer.status, 200, answer.text);
    assert.match(answer.headers['content-type'], /^text\/javascript/);
    assert.strictEqual(answer.text, mcp_bundle(), 'the file made from the modules as they are');
    assert.ok(answer.text.startsWith(`#!/usr/bin/env node\n\n// serviceman-mcp ${package_json.version} — one file, no dependencies.\n`));
    assert.doesNotMatch(answer.text, /"devDependencies"/, 'its version is written in, not package.json');
    assert.strictEqual((await socket_get(running.socket, '/api/v1/status')).status, 401, 'the socket wants a token for the rest');

    const box = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-mcp-box-'));
    t.after(() => fs.rmSync(box, {recursive: true, force: true}));
    const file = path.join(box, 'serviceman-mcp.js');
    fs.writeFileSync(file, answer.text);
    const usage = child_process.spawnSync(process.execPath, [file, '--help'], {cwd: box, env: {}, encoding: 'utf8'});
    assert.strictEqual(usage.status, 0, usage.stderr);
    assert.ok(usage.stdout.includes('-- node serviceman-mcp.js\n'), usage.stdout);

    fs.mkdirSync(path.join(box, 'site'));
    fs.writeFileSync(path.join(box, 'site', 'index.html'), '<title>Site</title>');
    const mcp = mcp_start(t, running, await token_make(running, 'a box', ['apps']), file);
    const hello = await mcp.call('initialize', HELLO);
    assert.deepStrictEqual(hello.result.serverInfo, {name: 'serviceman', title: 'serviceman', version: package_json.version});
    mcp.notify('notifications/initialized');
    assert.deepStrictEqual((await mcp.call('tools/list', {})).result.tools.map(v => v.name), ['app_send']);
    const sent = await mcp.call('tools/call', {name: 'app_send', arguments: {name: 'site', dir: 'site'}});
    assert.strictEqual(sent.result.isError, false, sent.result.content[0].text);
    assert.ok(sent.result.content[0].text.includes(`\nLink: http://site.localhost:${running.port}/ `), sent.result.content[0].text);
    assert.strictEqual((await fetch_host({port: running.port, host: 'site.localhost', path: '/'})).body, '<title>Site</title>');
    assert.strictEqual(await mcp.end(), 0);
});

// A serviceman of its own in a temp folder: its config file, which a new app is written into,
// its state beside it, and its control door on a socket there, for the agent, and on a port,
// for the test to make tokens with the owner's
async function serviceman_start(t)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-mcp-'));
    const config_path = path.join(dir, 'serviceman.json');
    const socket = path.join(dir, 'serviceman.sock');
    fs.writeFileSync(config_path, JSON.stringify({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0, socket},
        services: [],
    }, null, 4));
    const app = app_from_config(await profile_from_db(config_path));
    app.state_dir = path.join(dir, 'data');
    const servers = await server_start(app);
    t.after(function () {
        for (const door of [servers.server, servers.control, servers.socket]) {
            door.close();
            door.closeAllConnections();
        }
        fs.rmSync(dir, {recursive: true, force: true});
    });
    return {app, dir, socket, port: servers.server.address().port, control: servers.control.address().port};
}

// A token for an agent, made by the owner as the Tokens page makes one: its value, said once
async function token_make(running, label, rights)
{
    const body = JSON.stringify({label, remotes: [], rights});
    const answer = await fetch_host({port: running.control, method: 'POST', path: '/api/v1/tokens', body});
    assert.strictEqual(answer.status, 200, answer.body);
    return JSON.parse(answer.body).token;
}

// The MCP server as an agent starts it: in the folder it works in, with the token and the socket
// in its environment. Given a file, it is that one file run by node from its own folder, with
// nothing else in its environment, as in a box. call() writes a request and waits for the answer
// with its id; end() closes its stdin and waits for it to exit.
function mcp_start(t, running, token, file)
{
    const said = {SERVICEMAN_TOKEN: token, SERVICEMAN_SOCKET: running.socket};
    const child = (file === undefined)
        ? child_process.spawn(MCP, [], {cwd: running.dir, env: Object.assign({}, process.env, said), stdio: ['pipe', 'pipe', 'inherit']})
        : child_process.spawn(process.execPath, [file], {cwd: path.dirname(file), env: said, stdio: ['pipe', 'pipe', 'inherit']});
    t.after(function () {
        child.kill();
    });
    const waiting = new Map();
    let last_id = 0;
    const lines = readline.createInterface({input: child.stdout});
    lines.on('line', function (line) {
        const answer = JSON.parse(line);
        waiting.get(answer.id)(answer);
        waiting.delete(answer.id);
    });
    return {
        call: function (method, params) {
            last_id++;
            const id = last_id;
            child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`);
            return new Promise(function (resolve) {
                waiting.set(id, resolve);
            });
        },
        notify: function (method) {
            child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', method})}\n`);
        },
        end: function () {
            child.stdin.end();
            return new Promise(function (resolve) {
                child.once('exit', resolve);
            });
        },
    };
}

// A GET through serviceman's control socket with no token, as a box that has nothing yet asks
//
//     {status, headers, text}
function socket_get(socket, pathname)
{
    return new Promise(function (resolve, reject) {
        const request = http.get({socketPath: socket, path: pathname, headers: {host: 'localhost'}}, function (answer) {
            const chunks = [];
            answer.on('data', function (chunk) {
                chunks.push(chunk);
            });
            answer.on('end', function () {
                resolve({status: answer.statusCode, headers: answer.headers, text: Buffer.concat(chunks).toString('utf8')});
            });
        });
        request.on('error', reject);
    });
}
