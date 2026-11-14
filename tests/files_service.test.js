const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const os = require('os');
const path = require('path');
const reap_idle = require('../src/main/src/helpers/reap_idle');
const server_start = require('../src/main/src/helpers/server_start');
const service_phase = require('../src/main/src/helpers/service_phase');
const test = require('node:test');
const view_from_service = require('../src/main/src/helpers/view_from_service');
const ws = require('ws');

// A folder of files is a service of its own kind: no machine, no port, its folder read from the
// config's own folder, or none for the one serviceman keeps
test('a folder of files is read from the config, with no machine and no port', function () {
    const config = config_from_json({services: [
        {name: 'notes', type: 'files', publish: {host: 'notes.test'}},
        {name: 'docs', type: 'files', publish: {host: 'tools.test/docs'}, folder: 'site/docs'},
    ]}, '/srv/serviceman');
    assert.strictEqual(config.services[0].folder, null, 'serviceman keeps it: apps/notes in its state folder');
    assert.strictEqual(config.services[1].folder, '/srv/serviceman/site/docs');
    assert.deepStrictEqual(config.services[0].remotes, []);
    function bad(service) {
        return function () {
            return config_from_json({services: [service]}, '/srv/serviceman');
        };
    }
    assert.throws(bad({name: 'a', type: 'files', remote: 'vps1', publish: {host: 'a.test'}}), /served by serviceman itself; it names no machine/);
    assert.throws(bad({name: 'a', type: 'files', publish: {host: 'a.test', port: 8080}}), /nothing in it listens on a port/);
    assert.throws(bad({name: 'a', type: 'files'}), /at least one hostname is required|a hostname \(or a hosts array\) is required/);
});

// serviceman reads the files as they are asked for: a page, its scripts, any address the app
// keeps for itself answered with its index.html; nothing is woken, nothing outside the folder
// is read, and Start and Stop have nothing to do
test('a folder of files is served as it is, and nothing is started for it', async function (t) {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-files-'));
    const app_dir = path.join(state, 'apps', 'notes');
    fs.mkdirSync(path.join(app_dir, 'guide'), {recursive: true});
    fs.writeFileSync(path.join(app_dir, 'index.html'), '<title>Notes</title>');
    fs.writeFileSync(path.join(app_dir, 'app.js'), 'console.log("notes");');
    fs.writeFileSync(path.join(app_dir, 'guide', 'index.html'), '<title>Guide</title>');
    fs.writeFileSync(path.join(state, 'secret.txt'), 'not for visitors');
    const docs = path.join(state, 'docs');
    fs.mkdirSync(docs);
    fs.writeFileSync(path.join(docs, 'index.html'), '<title>Docs</title>');
    const before = process.env.SERVICEMAN_STATE_DIR;
    process.env.SERVICEMAN_STATE_DIR = state;
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        services: [
            {name: 'notes', title: 'Notes', type: 'files', publish: {host: 'notes.test'}},
            {name: 'docs', type: 'files', publish: {host: 'tools.test/docs'}, folder: docs},
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
        process.env.SERVICEMAN_STATE_DIR = before;
        fs.rmSync(state, {recursive: true, force: true});
    });
    const notes = app.service_by_name.notes;
    assert.strictEqual(service_phase(notes), 'running', 'nothing to start: it is there');

    const page = await fetch_host({port, host: 'notes.test', path: '/'});
    assert.strictEqual(page.status, 200);
    assert.strictEqual(page.body, '<title>Notes</title>');
    assert.match(page.headers['content-type'], /text\/html/);
    const script = await fetch_host({port, host: 'notes.test', path: '/app.js?v=2'});
    assert.strictEqual(script.status, 200);
    assert.match(script.headers['content-type'], /javascript/);
    const kept = await fetch_host({port, host: 'notes.test', path: '/notes/42'});
    assert.strictEqual(kept.body, '<title>Notes</title>', 'an address the app keeps for itself is its page');
    assert.strictEqual((await fetch_host({port, host: 'notes.test', path: '/gone.js'})).status, 404, 'a file that is not there is not the page');
    const folder = await fetch_host({port, host: 'notes.test', path: '/guide'});
    assert.strictEqual(folder.status, 301);
    assert.strictEqual(folder.headers.location, '/guide/');
    assert.strictEqual((await fetch_host({port, host: 'notes.test', path: '/guide/'})).body, '<title>Guide</title>');
    // Nothing outside its folder: dot segments are taken off as the address is read, and a
    // slash written as %2F is caught at the folder's edge
    const dots = await fetch_host({port, host: 'notes.test', path: '/%2e%2e/%2e%2e/secret.txt'});
    assert.strictEqual(dots.status, 404);
    assert.notStrictEqual(dots.body, 'not for visitors');
    const slashes = await fetch_host({port, host: 'notes.test', path: '/..%2F..%2Fsecret.txt'});
    assert.strictEqual(slashes.status, 403);
    assert.notStrictEqual(slashes.body, 'not for visitors');
    assert.strictEqual((await fetch_host({port, host: 'notes.test', path: '/', method: 'POST'})).status, 405);

    // On a path of a shared name, its files are from that path down
    assert.strictEqual((await fetch_host({port, host: 'tools.test', path: '/docs/'})).body, '<title>Docs</title>');
    assert.strictEqual((await fetch_host({port, host: 'tools.test', path: '/docs/intro'})).body, '<title>Docs</title>');

    // Quiet for an hour, it stays: there is nothing to put to sleep
    notes.state.instances[0].last_activity_at = Date.now() - 3600000;
    reap_idle(app);
    assert.strictEqual(service_phase(notes), 'running');
    const control = servers.control.address().port;
    for (const action of ['start', 'stop', 'restart']) {
        const answer = await fetch_host({port: control, host: '127.0.0.1', path: `/api/v1/services/notes/${action}`, method: 'POST'});
        assert.strictEqual(answer.status, 400, action);
        assert.match(JSON.parse(answer.body).error, /a folder of files serviceman serves itself; nothing runs to start or stop/);
    }
    assert.deepStrictEqual(view_from_service(notes).source, {label: 'Files', text: 'apps/notes', kept: true});
    assert.deepStrictEqual(view_from_service(app.service_by_name.docs).source, {label: 'Files', text: docs, kept: false});

    // A folder holds no socket to hand over
    const refused = await new Promise(function (resolve) {
        const socket = new ws(`ws://127.0.0.1:${port}/live`, {headers: {host: 'notes.test'}});
        socket.on('unexpected-response', (request, answer) => resolve(answer.statusCode));
        socket.on('error', () => resolve('error'));
        socket.on('open', () => resolve('open'));
    });
    assert.strictEqual(refused, 404);
});

// No files sent yet: the visitor is told there is no such page, and nothing breaks
test('a folder of files with nothing in it yet answers 404', async function (t) {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-files-'));
    const before = process.env.SERVICEMAN_STATE_DIR;
    process.env.SERVICEMAN_STATE_DIR = state;
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        services: [{name: 'empty', type: 'files', publish: {host: 'empty.test'}}],
    }, state);
    const app = app_from_config(config);
    const servers = await server_start(app);
    t.after(function () {
        servers.server.close();
        servers.control.close();
        servers.server.closeAllConnections();
        servers.control.closeAllConnections();
        process.env.SERVICEMAN_STATE_DIR = before;
        fs.rmSync(state, {recursive: true, force: true});
    });
    const answer = await fetch_host({port: servers.server.address().port, host: 'empty.test', path: '/'});
    assert.strictEqual(answer.status, 404);
});
