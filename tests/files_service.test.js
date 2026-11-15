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
    assert.strictEqual(said.public, null, 'no apps domain, no name outside');
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
    assert.deepStrictEqual(app_files_put.hosts({config: named}, 'my_notes'), ['my-notes.apps.example.com', 'my-notes.localhost'], 'both names: outside, and here with no DNS');
    const plain = config_from_json({services: []}, '/srv/serviceman');
    assert.deepStrictEqual(app_files_put.hosts({config: plain}, 'notes'), ['notes.localhost']);
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
    assert.match(render_apps_page({services: []}, {way: 'domain', domain: 'apps.test'}, 'apps.test'), /No app here yet: one sent to serviceman under apps\.test lands here/);
});

// With an apps domain, an app sent has both names: the one under the domain, for outside, and the
// one beside serviceman's own, which the computer serviceman runs on reaches with no DNS
test('an app sent with an apps domain answers on its name there and on its local one', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-apps-'));
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        apps: {domain: 'apps.example.com'},
        services: [],
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
    const made = await fetch_host({port: servers.control.address().port, host: '127.0.0.1', path: '/api/v1/apps/notes', method: 'PUT', body: zip_bytes([{name: 'index.html', bytes: Buffer.from('<title>Notes</title>')}])});
    assert.strictEqual(made.status, 201, made.body);
    const said = JSON.parse(made.body);
    assert.strictEqual(said.address, `http://notes.localhost:${port}/`, 'here: opens on this computer as it is');
    assert.strictEqual(said.public, 'notes.apps.example.com', 'outside: through a machine\'s door');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(config_path, 'utf8')).services[0].publish, {hosts: ['notes.apps.example.com', 'notes.localhost']});
    for (const host of ['notes.localhost', 'notes.apps.example.com']) {
        assert.strictEqual((await fetch_host({port, host, path: '/'})).body, '<title>Notes</title>', host);
    }
});

// A new name for an app, as its page's Name card saves it: its folder and the addresses made of
// its name go with it, an address given by hand stays, and a name another service has, or a
// folder an app of that name left behind, is refused. Before, the config said pad while the
// files stayed in apps/board and the app answered on board.localhost: gone under both names.
test('an app renamed on its page takes its folder and its addresses with it', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-apps-'));
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        apps: {domain: 'apps.example.com'},
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
    const apps_dir = path.join(dir, 'data', 'apps');
    function save(name, service) {
        return fetch_host({port: control, host: '127.0.0.1', path: `/api/v1/services/${name}`, method: 'PUT', body: JSON.stringify({service})});
    }
    function services() {
        return JSON.parse(fs.readFileSync(config_path, 'utf8')).services;
    }
    const made = await fetch_host({port: control, host: '127.0.0.1', path: '/api/v1/apps/board', method: 'PUT', body: zip_bytes([{name: 'index.html', bytes: Buffer.from('<title>Board</title>')}])});
    assert.strictEqual(made.status, 201, made.body);

    // What the page sends: the app as it is, its new name, and an address added by hand
    const renamed = await save('board', {name: 'pad', type: 'files', publish: {hosts: ['board.apps.example.com', 'board.localhost', 'board-wiki.example.com']}});
    assert.strictEqual(renamed.status, 200, renamed.body);
    assert.deepStrictEqual(services()[1], {name: 'pad', type: 'files', publish: {hosts: ['pad.apps.example.com', 'pad.localhost', 'board-wiki.example.com']}}, 'the names made of its name follow it; one given by hand stays');
    assert.ok(fs.existsSync(path.join(apps_dir, 'pad', 'index.html')), 'its files are in apps/pad');
    assert.strictEqual(fs.existsSync(path.join(apps_dir, 'board')), false, 'and nothing is left in apps/board');
    for (const host of ['pad.localhost', 'pad.apps.example.com', 'board-wiki.example.com']) {
        assert.strictEqual((await fetch_host({port, host, path: '/'})).body, '<title>Board</title>', host);
    }
    assert.strictEqual((await fetch_host({port, host: 'board.localhost', path: '/'})).status, 404, 'its old name answers nothing');

    const taken = await save('pad', {name: 'far', type: 'files', publish: {host: 'pad.localhost'}});
    assert.strictEqual(taken.status, 409, taken.body);
    assert.strictEqual(JSON.parse(taken.body).error, 'a service named "far" already exists');
    fs.mkdirSync(path.join(apps_dir, 'old'));
    const left = await save('pad', {name: 'old', type: 'files', publish: {host: 'pad.localhost'}});
    assert.strictEqual(left.status, 409, left.body);
    assert.strictEqual(JSON.parse(left.body).error, 'apps/old is there already, left by an app of that name before: send old a zip to take it back, or pick another name');
    assert.strictEqual(services()[1].name, 'pad', 'a refused name changes nothing');
    assert.strictEqual((await fetch_host({port, host: 'pad.localhost', path: '/'})).body, '<title>Board</title>');

    // A folder of its own, named in the config, stays where it is; its addresses still follow
    const own = path.join(dir, 'own');
    fs.mkdirSync(own);
    fs.writeFileSync(path.join(own, 'index.html'), '<title>Own</title>');
    assert.strictEqual((await save('pad', {name: 'pad', type: 'files', folder: own, publish: {host: 'pad.localhost'}})).status, 200);
    const moved = await save('pad', {name: 'site', type: 'files', folder: own, publish: {host: 'pad.localhost'}});
    assert.strictEqual(moved.status, 200, moved.body);
    assert.deepStrictEqual(services()[1].publish, {host: 'site.localhost'});
    assert.ok(fs.existsSync(path.join(own, 'index.html')), 'a folder the config names is not moved');
    assert.strictEqual((await fetch_host({port, host: 'site.localhost', path: '/'})).body, '<title>Own</title>');
});

// A rename, as the Apps card's Settings sends it, of an app run from its own folder: the address
// made of its name, the door rules that answer for it or put it in front of another, its secrets
// and the tokens kept to it all follow it. Before, the save was refused (a door rule named a
// service nobody had), and the secrets and tokens stayed under the old name.
test('an app run from its own folder renamed takes its address, door rules, secrets and tokens', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-apps-'));
    const config_path = path.join(dir, 'serviceman.json');
    const folder = path.join(dir, 'board');
    const board = {name: 'board', type: 'shell', remotes: ['vps1'], cwd: folder, command: 'bin/run', publish: {hosts: ['board.localhost', 'board-wiki.example.com'], port: 3100}};
    fs.writeFileSync(config_path, JSON.stringify({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'vps1', token: 'a'.repeat(64), inbound: {'board.example.com': {service: 'board', auth: 'wall'}, 'wall.example.com': {service: 'wall', auth: 'board'}, 'old.example.com': 'board'}}],
        services: [board, {name: 'wall', type: 'external', publish: {host: 'wall.localhost'}, upstream: '127.0.0.1:1'}],
    }, null, 4));
    fs.mkdirSync(path.join(dir, 'data'));
    fs.writeFileSync(path.join(dir, 'data', 'secrets.json'), JSON.stringify({global: {}, services: {board: {KEY: 'k1'}, wall: {KEY: 'k2'}}}));
    fs.writeFileSync(path.join(dir, 'data', 'control_tokens.json'), JSON.stringify([{id: 't1', label: 'ci', sha256: 'x', remotes: ['*'], rights: ['versions'], services: ['board', 'wall'], made_at: 1}]));
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
    const control = servers.control.address().port;
    const answer = await fetch_host({port: control, host: '127.0.0.1', path: '/api/v1/services/board', method: 'PUT', body: JSON.stringify({service: Object.assign({}, board, {name: 'pad'})})});
    assert.strictEqual(answer.status, 200, answer.body);
    const json = JSON.parse(fs.readFileSync(config_path, 'utf8'));
    assert.deepStrictEqual(json.services[0], Object.assign({}, board, {name: 'pad', publish: {hosts: ['pad.localhost', 'board-wiki.example.com'], port: 3100}}), 'the address made of its name follows it; one given by hand stays; its folder is where it was');
    assert.deepStrictEqual(json.remotes[0].inbound, {'board.example.com': {service: 'pad', auth: 'wall'}, 'wall.example.com': {service: 'wall', auth: 'pad'}, 'old.example.com': 'pad'});
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'data', 'secrets.json'), 'utf8')).services, {wall: {KEY: 'k2'}, pad: {KEY: 'k1'}});
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'data', 'control_tokens.json'), 'utf8'))[0].services, ['pad', 'wall']);
    const notes = JSON.parse(answer.body).notes;
    assert.ok(notes.includes('board: renamed to pad'), notes.join('; '));
    assert.strictEqual(notes.some(v => v.includes('removed from the config')), false, 'a rename, not a removal: no uninstall line runs');
});

// A folder dropped on the Apps page is zipped there: serviceman's own reader takes that zip as
// it takes any, names with letters past ASCII and folders under folders included
test('a folder zipped by the page is read by serviceman as a page\'s files', async function () {
    const zip_blob = (await import(path.join(__dirname, '..', 'src', 'main', 'public', 'zip_blob.js'))).default;
    const files_zip_items = require('../src/main/src/helpers/files_zip_items');
    const blob = await zip_blob([
        {path: 'my site/index.html', file: new Blob(['<title>Site</title>'])},
        {path: 'my site/assets/app.js', file: new Blob(['console.log(1);'])},
        {path: 'my site/Ünïcode.txt', file: new Blob(['ü'])},
        {path: 'my site/empty.txt', file: new Blob([])},
    ]);
    assert.strictEqual(blob.type, 'application/zip');
    const items = await files_zip_items('my site.zip', Buffer.from(await blob.arrayBuffer()));
    assert.deepStrictEqual(items.items.map(v => v.path), ['index.html', 'assets/app.js', 'Ünïcode.txt', 'empty.txt'], 'the one top folder taken off, as for any zip');
    assert.strictEqual(items.files, 4);
    const chunks = [];
    for await (const chunk of items.items[1].stream()) {
        chunks.push(chunk);
    }
    assert.strictEqual(Buffer.concat(chunks).toString(), 'console.log(1);');
});

// What is given to the Apps card goes as serviceman takes it: a page, 2.html, as an app of its
// own with the page as its index.html (1.0.94 sent it as it was, and serviceman called it a
// broken zip), a zip as it is once it reads, and what is neither is said on the card with its own
// name, nothing sent
test('the Apps card sends a page as an app of its own, a zip as it is, and says what is neither; a cell sends its app\'s new version', async function () {
    const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');
    const apps_pane = (await import(path.join(PUBLIC, 'apps_pane.js'))).default;
    const zip_blob = (await import(path.join(PUBLIC, 'zip_blob.js'))).default;
    const files_zip_items = require('../src/main/src/helpers/files_zip_items');
    const zip_entries = require('../src/main/src/helpers/zip_entries');
    const sent = [];
    const fetch_before = global.fetch;
    global.fetch = async function (url, options) {
        sent.push({url, body: Buffer.from(await options.body.arrayBuffer())});
        return new Response(JSON.stringify({made: true, address: 'http://x.localhost:3000/', public: null}), {status: 201});
    };
    try {
        const hi = {name: 'hi', type: 'shell', app_folder: '/srv/hi', publish: {hosts: ['hi.localhost']}};
        const card = Object.assign({state: {listen: {port: 3000}, apps: null}, apps: [hi], domain: null, names_on: false, sent: null}, apps_pane.methods);
        await apps_pane.methods.give.call(card, {file: new File(['<!doctype html><title>Two</title>'], '2.html')});
        assert.strictEqual(card.sent.error, '');
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0].url, '/api/v1/apps/2', 'named after the page, its .html off');
        const items = await files_zip_items('2.zip', sent[0].body);
        assert.deepStrictEqual(items.items.map(v => [v.path, v.size]), [['index.html', 33]]);

        const zip = Buffer.from(await (await zip_blob([{path: 'notes/index.html', file: new Blob(['<title>Notes</title>'])}])).arrayBuffer());
        await apps_pane.methods.give.call(card, {file: new File([zip], 'My Notes.zip')});
        assert.strictEqual(card.sent.error, '');
        assert.strictEqual(sent[1].url, '/api/v1/apps/my-notes');
        assert.ok(sent[1].body.equals(zip), 'a zip goes as it is');

        const refused = [
            [{file: new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'photo.png')}, 'photo.png: it is a PNG picture, not a zip.'],
            [{file: new File(['<!doctype html><title>Two</title>'], '2.zip')}, '2.zip: it is an HTML page, not a zip.'],
            [{file: new File([zip.subarray(0, 50)], 'cut.zip')}, 'cut.zip: it is a zip cut short: the list of its files, kept at its end, is missing.'],
            [{file: new File([], 'empty.zip')}, 'empty.zip: it is empty, not a zip.'],
            [{several: 3}, '3 things were dropped at once: drop one, a .zip, a folder or an .html page. Files that go together go as their folder.'],
        ];
        for (const [given, said] of refused) {
            await apps_pane.methods.give.call(card, given);
            assert.strictEqual(card.sent.error, said);
            assert.strictEqual(card.sent.busy, false);
        }
        assert.strictEqual(sent.length, 2, 'nothing refused was sent');

        // Given for an app already here, from its cell, it goes under that app's name, whatever
        // the file is called
        await apps_pane.methods.give.call(card, {file: new File(['<!doctype html><title>Draft</title>'], 'draft.html')}, 'journal');
        assert.strictEqual(card.sent.error, '');
        assert.strictEqual(sent[2].url, '/api/v1/apps/journal');
        await apps_pane.methods.give.call(card, {file: new File([zip], 'notes2.zip')}, 'board');
        assert.strictEqual(sent[3].url, '/api/v1/apps/board');
        assert.strictEqual(card.sent.name, 'board');
        // An app run from its own folder takes its zip as it is, or its folder zipped without
        // its data/, at its own new-version route; a page is no version of it, and goes nowhere
        await apps_pane.methods.give.call(card, {file: new File([zip], 'whatever.zip')}, 'hi');
        assert.strictEqual(card.sent.error, '');
        assert.strictEqual(sent[4].url, '/api/v1/services/hi/zip');
        assert.ok(sent[4].body.equals(zip));
        assert.strictEqual(card.sent.link, 'http://hi.localhost:3000/');
        await apps_pane.methods.give.call(card, {folder: [{path: 'hi/bin/run', file: new File(['#!/bin/sh'], 'run')}, {path: 'hi/data/keys.json', file: new File(['{}'], 'keys.json')}]}, 'hi');
        assert.strictEqual(card.sent.error, '');
        assert.deepStrictEqual(zip_entries(sent[5].body).filter(v => v.dir === false).map(v => v.name), ['hi/bin/run'], 'its data/ stays on its machine');
        await apps_pane.methods.give.call(card, {file: new File(['<p>x</p>'], 'page.html')}, 'hi');
        assert.strictEqual(card.sent.error, 'page.html: hi runs from its own folder, so its new version is a .zip of that folder, or the folder itself.');
        assert.strictEqual(sent.length, 6);

        // The picker sits outside the card that takes a new app: a click on it bubbles, and the
        // card's own click took the pick of a cell's New version for a new app (notes2.zip made
        // an app notes2 instead of board's new version)
        const card_html = apps_pane.template.slice(apps_pane.template.indexOf('<div class="app-drop"'));
        const card_end = card_html.indexOf('\n    </div>');
        assert.ok((card_end > 0) && (card_html.indexOf('ref="zip"') > card_end), 'the file input is not inside .app-drop');
    }
    finally {
        global.fetch = fetch_before;
    }
});
