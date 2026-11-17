const app_from_config = require('../src/main/src/helpers/app_from_config');
const app_ports_here = require('../src/main/src/helpers/app_ports_here');
const apps_page_of = require('../src/main/src/helpers/apps_page_of');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const os = require('os');
const path = require('path');
const render_apps_page = require('../src/main/src/helpers/render_apps_page');
const server_start = require('../src/main/src/helpers/server_start');
const tailnet_ip_read = require('../src/main/src/helpers/tailnet_ip_read');
const tailnet_name_read = require('../src/main/src/helpers/tailnet_name_read');
const test = require('node:test');

const TAILNET = {name: 'serviceman.tail1234.ts.net', ip: '100.64.0.20'};
const NO_TAILNET = {name: null, ip: null};

// One address to type in a browser and see every app: the apps domain itself, apps.localhost
// beside serviceman.localhost, and serviceman's own name on the tailnet, its first word or its
// tailnet address. Any other name is no page of apps.
test('a page of apps is asked by the apps domain, apps.localhost or serviceman\'s tailnet name', function () {
    const plain = {config: config_from_json({control: {host: 'serviceman.localhost'}, services: []}, '/srv')};
    const domain = {config: config_from_json({control: {host: 'serviceman.localhost'}, apps: {domain: 'apps.example.com'}, services: []}, '/srv')};
    const other = {config: config_from_json({control: {host: 'serviceman.example.org'}, services: []}, '/srv')};
    assert.deepStrictEqual(apps_page_of(domain, 'apps.example.com', NO_TAILNET), {way: 'domain', domain: 'apps.example.com'});
    assert.deepStrictEqual(apps_page_of(domain, 'apps.localhost', NO_TAILNET), {way: 'here', domain: null}, 'with a domain too');
    assert.deepStrictEqual(apps_page_of(plain, 'apps.localhost', NO_TAILNET), {way: 'here', domain: null});
    assert.deepStrictEqual(apps_page_of(other, 'apps.example.org', NO_TAILNET), {way: 'here', domain: null}, 'beside serviceman\'s own name, as an app is named');
    assert.strictEqual(apps_page_of(other, 'apps.localhost', NO_TAILNET), null);
    for (const host of ['serviceman.tail1234.ts.net', 'serviceman', '100.64.0.20']) {
        assert.deepStrictEqual(apps_page_of(plain, host, TAILNET), {way: 'tailnet', domain: null}, host);
    }
    assert.deepStrictEqual(apps_page_of(plain, 'serviceman.tail1234.ts.net', {name: 'Serviceman.Tail1234.ts.net', ip: null}), {way: 'tailnet', domain: null}, 'whatever case tailscale says it in');
    for (const host of ['serviceman.tail1234.ts.net', 'serviceman', '100.64.0.20', 'apps.example.com', 'notes.localhost', 'apps', '']) {
        assert.strictEqual(apps_page_of(plain, host, NO_TAILNET), null, `${host}: no tailnet, no domain`);
    }
    assert.strictEqual(apps_page_of(plain, 'laptop.tail1234.ts.net', TAILNET), null, 'another device\'s name');
    assert.strictEqual(apps_page_of(plain, '100.64.0.21', TAILNET), null, 'another device\'s address');
    // The apps off the tailnet: no page of them there, the one on this computer as it was
    const off = {config: config_from_json({control: {host: 'serviceman.localhost'}, apps: {ports: null}, services: []}, '/srv')};
    for (const host of ['serviceman.tail1234.ts.net', 'serviceman', '100.64.0.20']) {
        assert.strictEqual(apps_page_of(off, host, TAILNET), null, `${host}, with the apps off the tailnet`);
    }
    assert.deepStrictEqual(apps_page_of(off, 'apps.localhost', TAILNET), {way: 'here', domain: null});
});

// apps.localhost, on this computer: a cell for every service, at its name here on the port the
// page was asked on, and a service that has the name keeps it
test('apps.localhost is a page of every app, each at its name on this computer', async function (t) {
    const state = state_make(t, ['notes', 'board']);
    const app = app_from_config(config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        apps: {domain: 'apps.example.com', ports: null},
        services: [
            {name: 'notes', title: 'Notes', type: 'files', publish: {hosts: ['notes.apps.example.com', 'notes.localhost']}},
            {name: 'board', type: 'files', publish: {host: 'tools.example.com/board'}},
            {name: 'proxy', type: 'external', publish: {host: 'proxy.localhost'}, upstream: '127.0.0.1:1'},
        ],
    }, state));
    const port = await boot(t, app);
    const page = await fetch_host({port, host: `apps.localhost:${port}`, path: '/'});
    assert.strictEqual(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.body, /3 apps on this computer/);
    // A search box over the cells, each cell carrying what it is found by (apps_search.js)
    assert.match(page.body, /<input class="search" type="search"/);
    assert.ok(page.body.includes('data-words="[&quot;page&quot;,&quot;notes&quot;]"'), 'a cell is found by its kind and its name too');
    assert.match(page.body, /<script type="module">[\s\S]*function apps_search/);
    assert.ok(page.body.includes(`href="//notes.localhost:${port}/"`), 'its name on this computer, not the one under the domain');
    assert.ok(page.body.includes(`href="//tools.example.com:${port}/board"`), 'one with no name here: the one it has, its path too');
    assert.ok(page.body.indexOf('board') < page.body.indexOf('Notes'), 'by name');
    assert.ok(page.body.includes(`href="//proxy.localhost:${port}/"`), 'a service of another kind too, at its own name here');
    assert.ok(page.body.includes('data-words="[&quot;already running&quot;,&quot;proxy&quot;]"'), 'found by its kind');
    assert.strictEqual((await fetch_host({port, host: 'apps.localhost', path: '/more'})).status, 404, 'the page is / alone');
    assert.strictEqual((await fetch_host({port, host: 'apps.example.com', path: '/'})).status, 200, 'the domain\'s page stays');

    // A service that answers on apps.localhost keeps it
    const kept = app_from_config(config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        apps: {ports: null},
        services: [{name: 'apps', type: 'files', publish: {host: 'apps.localhost'}}],
    }, state_make(t, ['apps'])));
    const kept_port = await boot(t, kept);
    assert.strictEqual((await fetch_host({port: kept_port, host: 'apps.localhost', path: '/'})).body, '<title>apps</title>');
});

// serviceman's own name on the tailnet, as tailscale says it: a cell for every app, at its own
// port on the name the visitor typed, which their device reaches with nothing set up; one whose
// port does not listen opens nothing and says so
test('serviceman\'s tailnet name is a page of every app, each at its own port', async function (t) {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-tailscale-'));
    fs.writeFileSync(path.join(bin, 'tailscale'), `#!/bin/sh
if [ "$1" = "ip" ]; then echo ${TAILNET.ip}; else echo '{"Self": {"DNSName": "${TAILNET.name}."}}'; fi
`, {mode: 0o755});
    const path_before = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${path_before}`;
    t.after(function () {
        process.env.PATH = path_before;
        fs.rmSync(bin, {recursive: true, force: true});
    });
    assert.strictEqual(await tailnet_name_read(), TAILNET.name);
    assert.strictEqual(await tailnet_ip_read(), TAILNET.ip);
    const state = state_make(t, ['notes', 'board']);
    const app = app_from_config(config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        apps: {ports: 0},
        services: [
            {name: 'notes', title: 'Notes', type: 'files', publish: {host: 'notes.localhost'}},
            {name: 'board', type: 'files', publish: {host: 'board.localhost'}},
            {name: 'proxy', type: 'external', publish: {host: 'proxy.test'}, upstream: '127.0.0.1:1'},
        ],
    }, state));
    const port = await boot(t, app);
    const notes = app.app_ports_here.notes.port;
    const board = app.app_ports_here.board.port;
    for (const name of [TAILNET.name, 'serviceman', TAILNET.ip]) {
        const page = await fetch_host({port, host: `${name}:${port}`, path: '/'});
        assert.strictEqual(page.status, 200, name);
        assert.match(page.body, /3 apps on every device of your tailnet/);
        assert.ok(page.body.includes(`href="//${name}:${notes}/"`), `${name}: notes at its own port`);
        assert.ok(page.body.includes(`href="//${name}:${board}/"`), `${name}: board at its own port`);
        assert.ok(page.body.includes('<b>proxy</b><span class="host">no port</span>'), 'a service with no port of its own: said, opening nothing');
    }
    assert.strictEqual((await fetch_host({port, host: `notes.localhost:${notes}`, path: '/'})).body, '<title>notes</title>', 'the cell\'s port opens its app');
    assert.strictEqual((await fetch_host({port: notes, host: `${TAILNET.name}:${notes}`, path: '/'})).body, '<title>notes</title>', 'an app\'s own port is the app\'s, the page\'s name too');

    // One whose port does not listen is a cell that opens nothing
    app.app_ports_here.board.error = 'listen EADDRINUSE: address already in use 127.0.0.1:3402';
    const page = await fetch_host({port, host: TAILNET.name, path: '/'});
    assert.ok(page.body.includes(`href="//${TAILNET.name}:${notes}/"`));
    assert.strictEqual(page.body.includes(`:${board}/"`), false, 'no link to a port that does not listen');
    assert.match(page.body, new RegExp(`<div class="cell off"[^>]*>.*port ${board}.*its port is taken`));

});

// The words of an empty page, each way
test('a page of apps with no app says where one comes from', function () {
    const app = {services: [], app_ports_here: {}, tailnet_cert: {context: null, error: null}, config: config_from_json({control: {host: 'serviceman.localhost'}, services: []}, '/srv')};
    assert.match(render_apps_page(app, {way: 'domain', domain: 'apps.test'}, 'apps.test'), /0 apps under apps\.test.*No app here yet: one sent to serviceman under apps\.test lands here/s);
    assert.match(render_apps_page(app, {way: 'here', domain: null}, 'apps.localhost:3000'), /0 apps on this computer.*No app here yet: one dropped on serviceman's Apps page lands here/s);
    assert.match(render_apps_page(app, {way: 'tailnet', domain: null}, '100.64.0.20:3000'), /0 apps on every device of your tailnet/);
});

// On the tailnet the apps open at their own ports, over http while tailscale gives no
// certificate: the page says why, and where that is mended; on this computer it says nothing
test('on the tailnet, a page of apps says why its apps open over http', function () {
    const app = {services: [], app_ports_here: {}, tailnet_cert: {context: null, error: '500 Internal Server Error: your Tailscale account does not support getting TLS certs'}, config: config_from_json({control: {host: 'serviceman.localhost'}, services: []}, '/srv')};
    const page = render_apps_page(app, {way: 'tailnet', domain: null}, '100.64.0.20:3000');
    assert.match(page, /<p class="http-why">They open over http: HTTPS is off for your tailnet\. <a href="https:\/\/login\.tailscale\.com\/admin\/dns" target="_blank" rel="noopener">Turn HTTPS on in Tailscale/);
    assert.doesNotMatch(render_apps_page(app, {way: 'here', domain: null}, 'apps.localhost:3000'), /<p class="http-why">/);
    app.tailnet_cert.error = 'tailscale is down';
    assert.match(render_apps_page(app, {way: 'tailnet', domain: null}, '100.64.0.20:3000'), /They open over http: tailscale gives no certificate\.<\/p>/);
    app.tailnet_cert = {context: {}, error: null};
    assert.doesNotMatch(render_apps_page(app, {way: 'tailnet', domain: null}, '100.64.0.20:3000'), /<p class="http-why">/);
});

// A state folder of its own with an app of files for each name
function state_make(t, names)
{
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-apps-page-'));
    for (const name of names) {
        fs.mkdirSync(path.join(state, 'apps', name), {recursive: true});
        fs.writeFileSync(path.join(state, 'apps', name, 'index.html'), `<title>${name}</title>`);
    }
    const before = process.env.SERVICEMAN_STATE_DIR;
    process.env.SERVICEMAN_STATE_DIR = state;
    t.after(function () {
        process.env.SERVICEMAN_STATE_DIR = before;
        fs.rmSync(state, {recursive: true, force: true});
    });
    return state;
}

// serviceman started with its apps' ports open: the service port's number
async function boot(t, app)
{
    const servers = await server_start(app);
    await app_ports_here(app);
    t.after(async function () {
        servers.server.close();
        servers.control.close();
        servers.server.closeAllConnections();
        servers.control.closeAllConnections();
        app.config = Object.assign({}, app.config, {apps: Object.assign({}, app.config.apps, {ports: null})});
        await app_ports_here(app);
    });
    return servers.server.address().port;
}
