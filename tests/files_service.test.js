const app_files_put = require('../src/main/src/helpers/app_files_put');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const control_route_right = require('../src/main/src/helpers/control_route_right');
const doors_table = require('../src/main/src/helpers/doors_table');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile_from_db = require('../src/main/src/helpers/profile_from_db');
const reap_idle = require('../src/main/src/helpers/reap_idle');
const render_apps_page = require('../src/main/src/helpers/render_apps_page');
const server_start = require('../src/main/src/helpers/server_start');
const service_phase = require('../src/main/src/helpers/service_phase');
const test = require('node:test');
const view_from_service = require('../src/main/src/helpers/view_from_service');
const ws = require('ws');
const zip_bytes = require('./fixtures/zip_bytes');

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

// An app sent as a zip of its folder: a name serviceman has not seen becomes a folder of files in
// the config, at an address of its own, and is served at once; the next zip replaces it whole, a
// zip that is no page changes nothing, and a name taken by another kind is not touched
test('an app sent as a zip is made, served, and replaced whole by the next one', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-apps-'));
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        services: [{name: 'far', type: 'external', publish: {host: 'far.localhost'}, upstream: '127.0.0.1:1'}],
    }, null, 4));
    const before = process.env.SERVICEMAN_STATE_DIR;
    process.env.SERVICEMAN_STATE_DIR = path.join(dir, 'data');
    const app = app_from_config(await profile_from_db(config_path));
    const servers = await server_start(app);
    t.after(function () {
        servers.server.close();
        servers.control.close();
        servers.server.closeAllConnections();
        servers.control.closeAllConnections();
        process.env.SERVICEMAN_STATE_DIR = before;
        fs.rmSync(dir, {recursive: true, force: true});
    });
    const port = servers.server.address().port;
    const control = servers.control.address().port;
    function put(name, files) {
        return fetch_host({port: control, host: '127.0.0.1', path: `/api/v1/apps/${name}`, method: 'PUT', body: zip_bytes(files)});
    }

    const made = await put('notes', [
        {name: 'site/', bytes: null},
        {name: 'site/index.html', bytes: Buffer.from('<title>Notes 1</title>')},
        {name: 'site/app.js', bytes: Buffer.from('console.log(1);')},
        {name: 'site/data/list.json', bytes: Buffer.from('[1, 2]')},
    ]);
    assert.strictEqual(made.status, 201, made.body);
    const said = JSON.parse(made.body);
    assert.strictEqual(said.made, true);
    assert.strictEqual(said.address, `http://notes.localhost:${port}/`, 'named beside serviceman.localhost, as the New service form names one');
    assert.strictEqual(said.files, 3);
    const written = JSON.parse(fs.readFileSync(config_path, 'utf8'));
    assert.deepStrictEqual(written.services[1], {name: 'notes', type: 'files', publish: {host: 'notes.localhost'}}, 'written into the config like any service');
    assert.strictEqual((await fetch_host({port, host: 'notes.localhost', path: '/'})).body, '<title>Notes 1</title>');
    assert.strictEqual((await fetch_host({port, host: 'notes.localhost', path: '/data/list.json'})).body, '[1, 2]', 'a page\'s data/ is its content: nothing runs to keep one of its own');

    const again = await put('notes', [{name: 'index.html', bytes: Buffer.from('<title>Notes 2</title>')}]);
    assert.strictEqual(again.status, 200, again.body);
    assert.strictEqual(JSON.parse(again.body).made, false);
    assert.strictEqual((await fetch_host({port, host: 'notes.localhost', path: '/'})).body, '<title>Notes 2</title>');
    assert.strictEqual((await fetch_host({port, host: 'notes.localhost', path: '/app.js'})).status, 404, 'the old version went whole');
    assert.strictEqual(JSON.parse(fs.readFileSync(config_path, 'utf8')).services.length, 2, 'a known app is not written again');

    const no_page = await put('notes', [{name: 'readme.txt', bytes: Buffer.from('hello')}]);
    assert.strictEqual(no_page.status, 400);
    assert.match(JSON.parse(no_page.body).error, /notes\.zip has no index\.html, at its top or in its one folder/);
    const linked = await put('notes', [{name: 'index.html', bytes: Buffer.from('x')}, {name: 'up', bytes: Buffer.from('/etc'), link: true}]);
    assert.strictEqual(linked.status, 400);
    assert.match(JSON.parse(linked.body).error, /holds links/);
    assert.strictEqual((await fetch_host({port, host: 'notes.localhost', path: '/'})).body, '<title>Notes 2</title>', 'a refused zip changes nothing');

    const taken = await put('far', [{name: 'index.html', bytes: Buffer.from('x')}]);
    assert.strictEqual(taken.status, 409);
    assert.strictEqual(JSON.parse(taken.body).error, 'far is something already running, not a folder of files');
    assert.strictEqual((await put('Notes', [{name: 'index.html', bytes: Buffer.from('x')}])).status, 400);
    assert.strictEqual((await fetch_host({port: control, host: '127.0.0.1', path: '/api/v1/apps/notes'})).status, 405);
});

// Who may send an app: the owner, and a token given the right to; and the domain an app is named under
test('an app is sent with the apps right, and named under the apps domain', function () {
    assert.deepStrictEqual(control_route_right('PUT', '/api/v1/apps/notes'), {right: 'apps', said: 'send an app of files', remote: null});
    assert.strictEqual(control_route_right('PUT', '/api/v1/apps/notes/more'), null);
    const named = config_from_json({apps: {domain: 'apps.example.com'}, services: []}, '/srv/serviceman');
    assert.strictEqual(app_files_put.host({config: named}, 'my_notes'), 'my-notes.apps.example.com');
    const plain = config_from_json({services: []}, '/srv/serviceman');
    assert.strictEqual(app_files_put.host({config: plain}, 'notes'), 'notes.localhost');
    assert.throws(() => config_from_json({apps: {domain: '*.example.com'}, services: []}, '/srv/serviceman'), /apps\.domain: a lowercase domain/);
});

// A door's rule of "*" names no service: it is the one whose own address the name is, so the
// config takes it, and the table the machine routes by hands such a name to serviceman
test('a door rule of * is taken by the config, and the machine\'s table leaves it to serviceman', function () {
    const config = config_from_json({
        remotes: [{name: 'vps1', token: '0123456789abcdef0123456789abcdef', inbound: {'*.apps.example.com': {service: '*', auth: 'authwall'}}}],
        services: [
            {name: 'authwall', type: 'external', publish: {host: 'authwall.internal'}, upstream: '127.0.0.1:9000'},
            {name: 'notes', type: 'files', publish: {host: 'notes.apps.example.com'}},
        ],
    }, '/srv/serviceman');
    assert.deepStrictEqual(config.remotes[0].inbound['*.apps.example.com'], {service: '*', off: false, auth: 'authwall'});
    const app = app_from_config(config);
    const table = doors_table(app, app.remote_by_name.vps1);
    assert.deepStrictEqual(table.names['*.apps.example.com'], {service: '*', wall: 'authwall', off: false});
    assert.deepStrictEqual(Object.keys(table.services), ['authwall'], 'no service is called *');
    assert.throws(() => config_from_json({remotes: [{name: 'vps1', token: '0123456789abcdef0123456789abcdef', inbound: {'*.apps.example.com': {service: '*', auth: 'nowall'}}}], services: []}, '/srv/serviceman'), /behind "nowall", and no service has that name/);
});

// The apps domain itself is the page of its apps: a cell for every service whose own address is
// under it, each opening it on the port the visitor came in on; a service elsewhere is not on it
test('the apps domain is a page of a cell for each app under it', async function (t) {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-files-'));
    const before = process.env.SERVICEMAN_STATE_DIR;
    process.env.SERVICEMAN_STATE_DIR = state;
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        apps: {domain: 'apps.test'},
        services: [
            {name: 'notes', title: 'Notes', type: 'files', publish: {host: 'notes.apps.test'}},
            {name: 'agency', title: 'Visual Agency', type: 'external', publish: {host: 'agency.apps.test'}, upstream: '127.0.0.1:1'},
            {name: 'other', type: 'files', publish: {host: 'other.test'}},
        ],
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
    const port = servers.server.address().port;
    const page = await fetch_host({port, host: `apps.test:${port}`, path: '/'});
    assert.strictEqual(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.body, /2 apps under apps\.test/);
    assert.ok(page.body.includes(`href="//notes.apps.test:${port}/"`), 'a cell opens its app, on the port the visitor came in on');
    assert.ok(page.body.includes(`href="//agency.apps.test:${port}/"`));
    assert.ok(page.body.indexOf('Notes') < page.body.indexOf('Visual Agency'), 'by name');
    assert.strictEqual(page.body.includes('other.test'), false, 'a service elsewhere is not on it');
    assert.strictEqual((await fetch_host({port, host: 'apps.test', path: '/more'})).status, 404);
    assert.match(render_apps_page({services: []}, 'apps.test', 'apps.test'), /No app here yet: one sent to serviceman under apps\.test lands here/);
});
