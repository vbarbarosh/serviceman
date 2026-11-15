const app_domain_names = require('../src/main/src/helpers/app_domain_names');
const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const crypto = require('crypto');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');

// Apps of each kind, and a service that is no app: what a save of the config sees
function json_of(domain)
{
    return {
        apps: (domain === null) ? undefined : {domain},
        services: [
            {name: 'va', type: 'external', publish: {host: 'va.localhost'}, socket: 'sockets/va.sock'},
            {name: 'my_site', type: 'files', publish: {hosts: ['my-site.localhost']}},
            {name: 'notes', type: 'files', publish: {hosts: ['notes.apps.example.com', 'notes.localhost']}},
            {name: 'grafana', type: 'external', publish: {host: 'grafana.localhost'}, upstream: '127.0.0.1:3000'},
        ],
    };
}

function saved(domain, before)
{
    const json = JSON.parse(JSON.stringify(json_of(domain)));
    const config = config_from_json(json, '/srv/serviceman');
    return {json, named: app_domain_names(json, config, before)};
}

test('a domain set gives every app its name under it, made before the domain or after', function () {
    const {json, named} = saved('apps.example.com', null);
    assert.deepStrictEqual(named, {added: ['va', 'my_site'], removed: []}, 'notes had it already');
    assert.deepStrictEqual(json.services[0].publish, {hosts: ['va.apps.example.com', 'va.localhost']});
    assert.deepStrictEqual(json.services[1].publish, {hosts: ['my-site.apps.example.com', 'my-site.localhost']}, 'a _ is a - in an address');
    assert.deepStrictEqual(json.services[2].publish, {hosts: ['notes.apps.example.com', 'notes.localhost']});
    assert.deepStrictEqual(json.services[3].publish, {host: 'grafana.localhost'}, 'a service that is no app keeps its addresses');
});

test('a domain moved takes its old names away and gives the new ones; one taken away takes them all', function () {
    const moved = saved('apps.example.org', 'apps.example.com');
    assert.deepStrictEqual(moved.named.removed, ['notes']);
    assert.deepStrictEqual(moved.json.services[2].publish, {hosts: ['notes.apps.example.org', 'notes.localhost']});
    const gone = saved(null, 'apps.example.com');
    assert.deepStrictEqual(gone.named, {added: [], removed: ['notes']});
    assert.deepStrictEqual(gone.json.services[2].publish, {host: 'notes.localhost'});
    assert.deepStrictEqual(saved('apps.example.com', 'apps.example.com').named, {added: [], removed: []}, 'the same domain changes nothing');
});

test('a name another service answers is left to it', function () {
    const json = json_of('apps.example.com');
    json.services[3].publish = {hosts: ['grafana.localhost', 'va.apps.example.com']};
    const named = app_domain_names(json, config_from_json(json, '/srv/serviceman'), null);
    assert.ok(named.added.includes('va') === false);
    assert.deepStrictEqual(json.services[0].publish, {host: 'va.localhost'});
});

// The way the author takes: the Config page saves a domain, and an app made before it answers
// under it at once; the editor is given the text as saved
test('the Config page\'s save of a domain names every app under it, and va answers there', async function (t) {
    const answers = http.createServer((req, res) => res.end('va'));
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-names-'));
    const socket = path.join(state, 'sockets', 'va.sock');
    fs.mkdirSync(path.dirname(socket));
    await new Promise(function (resolve) {
        answers.listen(socket, resolve);
    });
    const before = process.env.SERVICEMAN_STATE_DIR;
    process.env.SERVICEMAN_STATE_DIR = state;
    const file = path.join(state, 'serviceman.json');
    const first = {listen: {host: '127.0.0.1', port: 0}, control: {host: 'serviceman.localhost', port: 0}, services: [{name: 'va', type: 'external', publish: {host: 'va.localhost'}, socket: 'sockets/va.sock'}]};
    fs.writeFileSync(file, `${JSON.stringify(first, null, 4)}\n`);
    const config = config_from_json(first, state);
    config.path = file;
    const app = app_from_config(config);
    const servers = await server_start(app);
    const port = servers.server.address().port;
    t.after(function () {
        servers.server.close();
        servers.control.close();
        servers.server.closeAllConnections();
        servers.control.closeAllConnections();
        answers.close();
        process.env.SERVICEMAN_STATE_DIR = before;
        fs.rmSync(state, {recursive: true, force: true});
    });
    assert.strictEqual((await fetch_host({port, host: 'va.apps.example.com', token: null})).status, 404, 'no domain yet');
    const on_disk = fs.readFileSync(file, 'utf8');
    const text = `${JSON.stringify(Object.assign({}, first, {apps: {domain: 'apps.example.com'}}), null, 4)}\n`;
    const hash = crypto.createHash('sha1').update(on_disk).digest('hex').slice(0, 12);
    const answer = await fetch_host({port, host: 'serviceman.localhost', method: 'POST', path: '/api/v1/config', body: JSON.stringify({text, hash})});
    assert.strictEqual(answer.status, 200, answer.body);
    const said = JSON.parse(answer.body);
    assert.ok(said.notes.some(v => v === 'va: named under apps.example.com too'), JSON.stringify(said.notes));
    assert.strictEqual(said.text, fs.readFileSync(file, 'utf8'), 'the editor is given the text as saved');
    assert.deepStrictEqual(JSON.parse(said.text).services[0].publish, {hosts: ['va.apps.example.com', 'va.localhost']});
    const there = await fetch_host({port, host: 'va.apps.example.com', token: null});
    assert.strictEqual(there.status, 200);
    assert.strictEqual(there.body, 'va');
});
