const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const control_route_right = require('../src/main/src/helpers/control_route_right');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile_from_db = require('../src/main/src/helpers/profile_from_db');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const zip_bytes = require('./fixtures/zip_bytes');

// Two boxes, each with a token kept to the apps it makes, and the owner. A box makes its app and
// sends its new versions; the owner's app and the other box's are refused to it, with a 403 that
// says why, and stay as they were. What it made is written down with the token, so a restart
// keeps it.
test('a token kept to the apps it makes sends its own, is refused the others\' and keeps its list across a restart', async function (t) {
    const dir = dir_make(t, {services: [{name: 'far', type: 'external', publish: {host: 'far.localhost'}, upstream: '127.0.0.1:1'}]});
    let running = await serviceman_start(t, dir);
    assert.strictEqual((await app_put(running, 'wiki', 'Wiki of the owner')).status, 201, 'the owner\'s own app');
    const box = await token_make(running, {label: 'a box', remotes: [], rights: ['apps'], apps_own: true});
    const other = await token_make(running, {label: 'another box', remotes: [], rights: ['apps'], apps_own: true});
    assert.deepStrictEqual([box.item.apps_own, box.item.apps], [true, []]);

    const made = await app_put(running, 'notes', 'Notes 1', box.token);
    assert.strictEqual(made.status, 201, made.body);
    assert.deepStrictEqual(tokens_kept(dir).find(v => v.label === 'a box').apps, ['notes'], 'written down with the token');
    const again = await app_put(running, 'notes', 'Notes 2', box.token);
    assert.strictEqual(again.status, 200, again.body);
    assert.strictEqual(await page_of(running, 'notes'), '<title>Notes 2</title>');

    // Another's name: refused before its zip is read, and the app serves its own files
    const owners = await app_put(running, 'wiki', 'Wiki of a box', box.token);
    assert.deepStrictEqual([owners.status, JSON.parse(owners.body).error], [403, 'the token "a box" may not send a new version of wiki: it sends only the apps it made, notes']);
    assert.strictEqual(await page_of(running, 'wiki'), '<title>Wiki of the owner</title>');
    const boxes = await app_put(running, 'notes', 'Notes of another box', other.token);
    assert.deepStrictEqual([boxes.status, JSON.parse(boxes.body).error], [403, 'the token "another box" may not send a new version of notes: it sends only the apps it made, and it has made none']);
    assert.strictEqual(await page_of(running, 'notes'), '<title>Notes 2</title>');
    assert.ok(running.app.log_lines.some(v => v.includes('[control_token_refused]') && v.includes('token="another box"') && v.includes('may not send a new version of notes')), 'the log says whose and why');
    // A name of another kind is no less another's: refused, not told what it is
    const far = await app_put(running, 'far', 'Far', box.token);
    assert.deepStrictEqual([far.status, JSON.parse(far.body).error], [403, 'the token "a box" may not send a new version of far: it sends only the apps it made, notes']);
    // An app on a socket is made and kept the same way
    const socket = await call(running, 'PUT', '/api/v1/apps/agency/socket', {socket: 'sockets/agency.sock'}, box.token);
    assert.strictEqual(socket.status, 201, socket.body);
    const socket_owners = await call(running, 'PUT', '/api/v1/apps/wiki/socket', {socket: 'sockets/wiki.sock'}, box.token);
    assert.deepStrictEqual([socket_owners.status, JSON.parse(socket_owners.body).error], [403, 'the token "a box" may not send a new version of wiki: it sends only the apps it made, notes, agency']);
    assert.strictEqual(running.app.service_by_name.wiki.type, 'files', 'the owner\'s app is as it was');

    // Each lists what it may send to: its own; the owner every app of files and on a socket
    const port = running.port;
    assert.deepStrictEqual(await apps_listed(running, box.token), {apps_own: true, apps: [
        {name: 'notes', kind: 'files', address: `http://notes.localhost:${port}/`, public: null},
        {name: 'agency', kind: 'socket', address: `http://agency.localhost:${port}/`, public: null},
    ]});
    assert.deepStrictEqual(await apps_listed(running, other.token), {apps_own: true, apps: []});
    assert.deepStrictEqual((await apps_listed(running, undefined)).apps.map(v => v.name), ['wiki', 'notes', 'agency'], 'far is no app the apps right sends');
    const reader = await token_make(running, {label: 'a reader', remotes: [], rights: ['status']});
    const not_listed = await call(running, 'GET', '/api/v1/apps', null, reader.token);
    assert.deepStrictEqual([not_listed.status, JSON.parse(not_listed.body).error], [403, 'the token "a reader" may not list the apps']);

    // Started again from its files, it is the same
    await running.stop();
    running = await serviceman_start(t, dir);
    assert.strictEqual((await app_put(running, 'notes', 'Notes 3', box.token)).status, 200);
    assert.strictEqual((await app_put(running, 'wiki', 'Wiki of a box', box.token)).status, 403);
    assert.strictEqual(await page_of(running, 'wiki'), '<title>Wiki of the owner</title>');
    assert.deepStrictEqual((await apps_listed(running, box.token)).apps.map(v => v.name), ['notes', 'agency']);
});

// A token made without the keep, or before it was, sends under any name as it always did; its
// apps are written down all the same, so the keep ticked later finds them. A name follows its
// app's rename, and leaves the list when the app is removed: one made again under it, by the
// owner or by another, is not the token's.
test('a token without the keep sends as before; its list follows a rename and loses an app removed', async function (t) {
    const dir = dir_make(t, {services: []});
    // A token of a file written by hand, its list naming an app that is not there
    fs.mkdirSync(path.join(dir, 'data'));
    fs.writeFileSync(path.join(dir, 'data', 'control_tokens.json'), JSON.stringify([{id: 'a1', label: 'a box of before', sha256: 'x', remotes: [], rights: ['apps'], apps_own: true, apps: ['ghost'], made_at: '2026-01-01T00:00:00.000Z'}]));
    const running = await serviceman_start(t, dir);
    // The name it kept while its app was taken out by hand is not its own once the owner makes
    // it: whoever makes a name has it
    assert.strictEqual((await app_put(running, 'ghost', 'Ghost of the owner')).status, 201);
    assert.deepStrictEqual(tokens_kept(dir).find(v => v.id === 'a1').apps, []);
    assert.strictEqual((await app_put(running, 'wiki', 'Wiki of the owner')).status, 201);
    const plain = await token_make(running, {label: 'a plain box', remotes: [], rights: ['apps']});
    assert.deepStrictEqual([plain.item.apps_own, plain.item.apps], [false, []]);
    const kept_status = await token_make(running, {label: 'a reader', remotes: [], rights: ['status'], apps_own: true});
    assert.strictEqual(kept_status.item.apps_own, false, 'the keep is of the apps right alone');

    assert.strictEqual((await app_put(running, 'notes', 'Notes', plain.token)).status, 201);
    const replaced = await app_put(running, 'wiki', 'Wiki of a plain box', plain.token);
    assert.strictEqual(replaced.status, 200, 'any name, as before');
    assert.strictEqual(await page_of(running, 'wiki'), '<title>Wiki of a plain box</title>');
    assert.deepStrictEqual(await apps_listed(running, plain.token), await apps_listed(running, undefined), 'every app, as the owner sees them');
    assert.strictEqual((await apps_listed(running, plain.token)).apps_own, false);
    assert.deepStrictEqual(tokens_kept(dir).find(v => v.label === 'a plain box').apps, ['notes'], 'what it made, not what it replaced');

    // Kept from now on: its own app, and no other
    const body = {label: 'a plain box', remotes: [], rights: ['apps'], apps_own: true};
    const changed = await call(running, 'PUT', `/api/v1/tokens/${plain.item.id}`, body, running.owner);
    assert.deepStrictEqual(JSON.parse(changed.body).item.apps, ['notes'], 'an edit keeps the list');
    assert.strictEqual((await app_put(running, 'notes', 'Notes 2', plain.token)).status, 200);
    assert.strictEqual((await app_put(running, 'wiki', 'Wiki again', plain.token)).status, 403);

    // Renamed on its Settings, its new name is the token's; the old one is free for a new app
    const renamed = await call(running, 'PUT', '/api/v1/services/notes', {service: {name: 'pad', type: 'files', publish: {host: 'pad.localhost'}}}, running.owner);
    assert.strictEqual(renamed.status, 200, renamed.body);
    assert.deepStrictEqual(tokens_kept(dir).find(v => v.label === 'a plain box').apps, ['pad']);
    assert.strictEqual((await app_put(running, 'pad', 'Pad', plain.token)).status, 200);
    assert.strictEqual((await app_put(running, 'notes', 'Notes anew', plain.token)).status, 201);
    assert.deepStrictEqual(tokens_kept(dir).find(v => v.label === 'a plain box').apps, ['pad', 'notes']);

    // Removed, it leaves the list; made again by the owner, it is the owner's
    assert.strictEqual((await call(running, 'DELETE', '/api/v1/services/pad', null, running.owner)).status, 200);
    assert.deepStrictEqual(tokens_kept(dir).find(v => v.label === 'a plain box').apps, ['notes']);
    assert.strictEqual((await app_put(running, 'pad', 'Pad of the owner')).status, 201);
    assert.strictEqual((await app_put(running, 'pad', 'Pad of a box', plain.token)).status, 403);
    assert.strictEqual(await page_of(running, 'pad'), '<title>Pad of the owner</title>');
});

test('the list of apps is the apps right\'s', function () {
    assert.deepStrictEqual(control_route_right('GET', '/api/v1/apps'), {right: 'apps', said: 'list the apps', remote: null});
    assert.strictEqual(control_route_right('PUT', '/api/v1/apps'), null, 'the apps\' settings stay the owner\'s');
});

// A folder for one serviceman: its config file, which a new app is written into, and its state
// beside it in data/, kept when it stops so that it can be started again from them
function dir_make(t, config)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-apps-own-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    fs.writeFileSync(path.join(dir, 'serviceman.json'), JSON.stringify(Object.assign({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
    }, config), null, 4));
    return dir;
}

// serviceman from the files of a folder; stop() closes its doors and leaves the files
async function serviceman_start(t, dir)
{
    const app = app_from_config(await profile_from_db(path.join(dir, 'serviceman.json')));
    app.state_dir = path.join(dir, 'data');
    const servers = await server_start(app);
    let stopped = false;
    function stop() {
        if (stopped) {
            return;
        }
        stopped = true;
        for (const door of [servers.server, servers.control]) {
            door.close();
            door.closeAllConnections();
        }
    }
    t.after(stop);
    return {app, stop, port: servers.server.address().port, control: servers.control.address().port, owner: fetch_host.OWNER_TOKEN};
}

async function token_make(running, body)
{
    const answer = await call(running, 'POST', '/api/v1/tokens', body, running.owner);
    assert.strictEqual(answer.status, 200, answer.body);
    return JSON.parse(answer.body);
}

// An app of one page, its title the text given; token undefined for the owner's
function app_put(running, name, title, token)
{
    const body = zip_bytes([{name: 'index.html', bytes: Buffer.from(`<title>${title}</title>`)}]);
    return fetch_host({port: running.control, method: 'PUT', path: `/api/v1/apps/${name}`, body, token});
}

async function apps_listed(running, token)
{
    const answer = await call(running, 'GET', '/api/v1/apps', null, token);
    assert.strictEqual(answer.status, 200, answer.body);
    return JSON.parse(answer.body);
}

function call(running, method, asked, body, token)
{
    return fetch_host({port: running.control, method, path: asked, token, body: (body === null) ? undefined : JSON.stringify(body)});
}

async function page_of(running, name)
{
    return (await fetch_host({port: running.port, host: `${name}.localhost`, path: '/'})).body;
}

// The tokens as their file keeps them
function tokens_kept(dir)
{
    return JSON.parse(fs.readFileSync(path.join(dir, 'data', 'control_tokens.json'), 'utf8'));
}
