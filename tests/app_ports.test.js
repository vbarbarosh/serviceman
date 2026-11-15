const app_apply_config = require('../src/main/src/helpers/app_apply_config');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const app_ports_here = require('../src/main/src/helpers/app_ports_here');
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

// apps.ports is the first of the apps' own ports: 3400 unless said, whichever is free beside a
// listen.port of 0, none with null
test('apps.ports: 3400 by default, 0 beside a listen.port of 0, null for none', function () {
    assert.strictEqual(config_from_json({services: []}, '/srv').apps.ports, 3400);
    assert.strictEqual(config_from_json({listen: {port: 3000}, apps: {domain: 'apps.example.com'}, services: []}, '/srv').apps.ports, 3400);
    assert.strictEqual(config_from_json({listen: {port: 0}, services: []}, '/srv').apps.ports, 0);
    assert.strictEqual(config_from_json({apps: {ports: 4200}, services: []}, '/srv').apps.ports, 4200);
    assert.strictEqual(config_from_json({apps: {ports: null}, services: []}, '/srv').apps.ports, null);
    for (const bad of [-1, 65536, 3400.5, '3400', true]) {
        assert.throws(() => config_from_json({apps: {ports: bad}, services: []}, '/srv'), /apps\.ports: the first of the apps' own ports is required, 3400, or null for none/, String(bad));
    }
});

// Every app answers on a port of its own whatever name the request carries, as it does on its
// own names; nothing else is reached there, the control page least of all. The ports are kept:
// the same after a restart, one follows a rename, one is let go with its app and is the next
// new app's.
test('every app has a port of its own, kept, and nothing but the app answers on it', async function (t) {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-app-ports-'));
    for (const name of ['notes', 'board']) {
        fs.mkdirSync(path.join(state, 'apps', name), {recursive: true});
        fs.writeFileSync(path.join(state, 'apps', name, 'index.html'), `<title>${name}</title>`);
    }
    const before = process.env.SERVICEMAN_STATE_DIR;
    process.env.SERVICEMAN_STATE_DIR = state;
    const echo = await server_of(function (req, res) {
        res.end('not an app');
    });
    const first = await ports_free(4);
    const json = {
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        apps: {ports: first},
        services: [
            {name: 'notes', type: 'files', publish: {host: 'notes.localhost'}},
            {name: 'proxy', type: 'external', publish: {host: 'proxy.test'}, upstream: `127.0.0.1:${echo.address().port}`},
            {name: 'board', type: 'files', publish: {host: 'board.localhost'}},
        ],
    };
    const started = [];
    async function boot(config_json) {
        const app = app_from_config(config_from_json(config_json, state));
        const servers = await server_start(app);
        await app_ports_here(app);
        started.push({app, servers});
        return app;
    }
    async function stop(app) {
        const found = started.find(v => v.app === app);
        found.servers.server.close();
        found.servers.control.close();
        found.servers.server.closeAllConnections();
        found.servers.control.closeAllConnections();
        app.config = Object.assign({}, app.config, {apps: Object.assign({}, app.config.apps, {ports: null})});
        await app_ports_here(app);
    }
    t.after(async function () {
        for (const item of started) {
            await stop(item.app);
        }
        echo.close();
        process.env.SERVICEMAN_STATE_DIR = before;
        fs.rmSync(state, {recursive: true, force: true});
    });

    let app = await boot(json);
    assert.deepStrictEqual(ports_of(app), {notes: first, board: first + 1}, 'the apps, in the config\'s order; a proxy is no app');
    assert.deepStrictEqual(kept_of(state), {notes: first, board: first + 1});

    // Whatever name it carries: the tailnet's name for serviceman, an address, the control page's
    for (const host of ['serviceman.tail1234.ts.net', '100.64.0.20', 'serviceman.localhost', 'board.localhost', 'proxy.test']) {
        const page = await fetch_host({port: first, host, path: '/'});
        assert.strictEqual(page.status, 200, host);
        assert.strictEqual(page.body, '<title>notes</title>', host);
    }
    const api = await fetch_host({port: first, host: 'serviceman.localhost', path: '/api/v1/state'});
    assert.strictEqual(api.body, '<title>notes</title>', 'the control page\'s address is the app\'s own page here');
    assert.strictEqual((await fetch_host({port: first + 1, host: 'serviceman.tail1234.ts.net', path: '/x'})).body, '<title>board</title>');
    // The control page's handshake is not reached on it either: a folder of files holds no socket
    const handshake = await new Promise(function (resolve) {
        const socket = new ws(`ws://127.0.0.1:${first}/api/v1/live`, {headers: {host: 'serviceman.localhost'}});
        socket.on('unexpected-response', (request, answer) => resolve(answer.statusCode));
        socket.on('error', () => resolve('error'));
        socket.on('open', function () {
            socket.close();
            resolve('open');
        });
    });
    assert.strictEqual(handshake, 404);

    // Started again, every app is where it was
    await stop(app);
    app = await boot(json);
    assert.deepStrictEqual(ports_of(app), {notes: first, board: first + 1});

    // Renamed, it keeps its port; taken out, its port goes, and the next new app has it
    const renamed = structuredClone(json);
    renamed.services[0] = {name: 'wiki', type: 'files', publish: {host: 'wiki.localhost'}};
    fs.renameSync(path.join(state, 'apps', 'notes'), path.join(state, 'apps', 'wiki'));
    await app_apply_config(app, config_from_json(renamed, state), {renamed: {notes: 'wiki'}});
    assert.deepStrictEqual(ports_of(app), {wiki: first, board: first + 1});
    assert.strictEqual((await fetch_host({port: first, host: 'serviceman.tail1234.ts.net', path: '/'})).body, '<title>notes</title>', 'the same app, its folder moved with its name');
    assert.strictEqual(app.app_ports_here.wiki.server.listening, true);
    const removed = structuredClone(renamed);
    removed.services.splice(0, 1);
    await app_apply_config(app, config_from_json(removed, state));
    assert.deepStrictEqual(ports_of(app), {board: first + 1});
    assert.deepStrictEqual(kept_of(state), {board: first + 1});
    await assert.rejects(fetch_host({port: first, host: 'serviceman.tail1234.ts.net', path: '/'}), /ECONNREFUSED/, 'nothing listens on a port let go');
    const added = structuredClone(removed);
    added.services.push({name: 'notes', type: 'files', publish: {host: 'notes.localhost'}});
    fs.renameSync(path.join(state, 'apps', 'wiki'), path.join(state, 'apps', 'notes'));
    await app_apply_config(app, config_from_json(added, state));
    assert.deepStrictEqual(ports_of(app), {board: first + 1, notes: first});

    // Turned off, every port closes and what is kept stays for the day they are back
    const off = structuredClone(added);
    off.apps.ports = null;
    await app_apply_config(app, config_from_json(off, state));
    assert.deepStrictEqual(ports_of(app), {});
    assert.deepStrictEqual(kept_of(state), {board: first + 1, notes: first});
    await assert.rejects(fetch_host({port: first + 1, path: '/'}), /ECONNREFUSED/);
});

// A port another program holds is said in the log and on the page, the other apps listen all
// the same, and it opens once the port is free: the minute tries it again
test('an app whose port is held elsewhere listens once it is free', async function (t) {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-app-ports-'));
    for (const name of ['notes', 'board']) {
        fs.mkdirSync(path.join(state, 'apps', name), {recursive: true});
        fs.writeFileSync(path.join(state, 'apps', name, 'index.html'), `<title>${name}</title>`);
    }
    const before = process.env.SERVICEMAN_STATE_DIR;
    process.env.SERVICEMAN_STATE_DIR = state;
    const first = await ports_free(2);
    const holder = net.createServer();
    await new Promise(v => holder.listen(first, '127.0.0.1', v));
    const app = app_from_config(config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        apps: {ports: first},
        services: [
            {name: 'notes', type: 'files', publish: {host: 'notes.localhost'}},
            {name: 'board', type: 'files', publish: {host: 'board.localhost'}},
        ],
    }, state));
    const servers = await server_start(app);
    t.after(async function () {
        servers.server.close();
        servers.control.close();
        servers.server.closeAllConnections();
        servers.control.closeAllConnections();
        app.config = Object.assign({}, app.config, {apps: Object.assign({}, app.config.apps, {ports: null})});
        await app_ports_here(app);
        holder.close();
        process.env.SERVICEMAN_STATE_DIR = before;
        fs.rmSync(state, {recursive: true, force: true});
    });
    await app_ports_here(app);
    assert.match(app.app_ports_here.notes.error, /EADDRINUSE/);
    assert.strictEqual(app.app_ports_here.notes.port, first, 'it keeps its port, and waits for it');
    assert.strictEqual(app.app_ports_here.board.error, null);
    assert.strictEqual((await fetch_host({port: first + 1, path: '/'})).body, '<title>board</title>');
    assert.strictEqual(app.log_lines.filter(v => /app_port_listen_error/.test(v)).length, 1);
    await app_ports_here(app);
    assert.strictEqual(app.log_lines.filter(v => /app_port_listen_error/.test(v)).length, 1, 'the same reason is said once');

    await new Promise(v => holder.close(v));
    await app_ports_here(app);
    assert.strictEqual(app.app_ports_here.notes.error, null);
    assert.strictEqual((await fetch_host({port: first, path: '/'})).body, '<title>notes</title>');
});

// An app behind a wall is behind it on its own port too, and the wall's sign-in answers there
test('an app behind a wall stays behind it on its own port', async function (t) {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-app-ports-'));
    fs.mkdirSync(path.join(state, 'apps', 'notes'), {recursive: true});
    fs.writeFileSync(path.join(state, 'apps', 'notes', 'index.html'), '<title>Notes</title>');
    const before = process.env.SERVICEMAN_STATE_DIR;
    process.env.SERVICEMAN_STATE_DIR = state;
    const wall = await server_of(function (req, res) {
        if (req.url === '/auth/sidecar') {
            const good = (req.headers.cookie === 'session=good');
            res.writeHead(good ? 200 : 401, good ? {'x-auth-user': 'user@example.com'} : {});
            res.end();
            return;
        }
        res.end(`the wall's own page ${req.url}`);
    });
    const first = await ports_free(1);
    const app = app_from_config(config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        apps: {ports: first},
        services: [
            {name: 'authwall', type: 'external', publish: {host: 'authwall.test'}, upstream: `127.0.0.1:${wall.address().port}`},
            {name: 'notes', type: 'files', publish: {host: 'notes.localhost'}, auth: 'authwall'},
        ],
    }, state));
    const servers = await server_start(app);
    t.after(async function () {
        servers.server.close();
        servers.control.close();
        servers.server.closeAllConnections();
        servers.control.closeAllConnections();
        app.config = Object.assign({}, app.config, {apps: Object.assign({}, app.config.apps, {ports: null})});
        await app_ports_here(app);
        wall.close();
        process.env.SERVICEMAN_STATE_DIR = before;
        fs.rmSync(state, {recursive: true, force: true});
    });
    await app_ports_here(app);
    const refused = await fetch_host({port: first, host: 'serviceman.tail1234.ts.net', path: '/guide', token: null});
    assert.strictEqual(refused.status, 302);
    assert.strictEqual(refused.headers.location, '/auth/sign-in?return=%2Fguide');
    const sign_in = await fetch_host({port: first, host: 'serviceman.tail1234.ts.net', path: '/auth/sign-in?return=%2F', token: null});
    assert.strictEqual(sign_in.body, 'the wall\'s own page /auth/sign-in?return=%2F');
    const through = await fetch_host({port: first, host: 'serviceman.tail1234.ts.net', path: '/', token: null, headers: {cookie: 'session=good'}});
    assert.strictEqual(through.body, '<title>Notes</title>');
});

function ports_of(app)
{
    const out = {};
    for (const name of Object.keys(app.app_ports_here)) {
        const found = app.app_ports_here[name];
        assert.strictEqual(found.error, null, name);
        out[name] = found.port;
    }
    return out;
}

function kept_of(state)
{
    return JSON.parse(fs.readFileSync(path.join(state, app_ports_here.FILE), 'utf8'));
}

function server_of(handler)
{
    return new Promise(function (resolve) {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', function () {
            resolve(server);
        });
    });
}

// A first port with `count` free ones from it up, on the loopback
async function ports_free(count)
{
    for (let tries = 0; tries < 50; tries++) {
        const first = 20000 + Math.floor(Math.random()*30000);
        const held = [];
        let free = true;
        for (let i = 0; i < count; i++) {
            const server = net.createServer();
            const ok = await new Promise(function (resolve) {
                server.once('error', () => resolve(false));
                server.listen(first + i, '127.0.0.1', () => resolve(true));
            });
            if (ok === false) {
                free = false;
                break;
            }
            held.push(server);
        }
        for (const server of held) {
            await new Promise(v => server.close(v));
        }
        if (free) {
            return first;
        }
    }
    throw new Error('no free ports');
}
