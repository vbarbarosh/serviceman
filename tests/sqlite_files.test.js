const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const fetch_host = require('./fetch_host');
const fs = require('fs');
const node_sqlite_refusal_of = require('../src/helpers/node_sqlite_refusal_of');
const os = require('os');
const path = require('path');
const profile_from_db = require('../src/main/src/helpers/profile_from_db');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');
const TOKEN = 'token-of-the-laptop-0123456789';
// Why this Node cannot run the agent's reader, false when it can
const SKIPPED = node_sqlite_refusal_of(process.version) || false;
// A statement that never ends by itself: the numbers counted one by one, for ever
const ENDLESS = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c';

// A machine with its agent, and SQLite files in a folder of it: the page's requests go the
// whole way, through serviceman and the link to the agent, which reads the file itself
test('a SQLite file of a machine is browsed through its agent: its head, its tables, its rows, a query', {skip: SKIPPED}, async function (t) {
    const world = await world_start(t);
    const file = shop_make(world.files);
    const base = `/api/v1/remotes/laptop/sqlite/${encodeURIComponent(file)}/browse`;

    const head = await control(world, 'GET', base);
    assert.deepStrictEqual([head.status, head.body.engine, head.body.database, head.body.remote, head.body.path, head.body.label, head.body.size], [200, 'sqlite', 'shop.db', 'laptop', file, 'SQLite', fs.statSync(file).size]);
    const collections = await control(world, 'GET', `${base}/collections`);
    assert.deepStrictEqual([collections.status, collections.body.items.map(v => `${v.name} ${v.type} ${v.count}`)], [200, ['notes table 2', 'recent view null']]);
    const page = await control(world, 'GET', `${base}/documents?${new URLSearchParams({collection: 'notes', filter: 'id > 1', limit: '20'})}`);
    assert.deepStrictEqual([page.status, page.body.items, page.body.columns, page.body.count, page.body.skip, page.body.limit], [200, [{id: 2, text: 'world', big: {$numberLong: '9007199254740993'}}], ['id', 'text', 'big'], 1, 0, 20]);
    const query = await control(world, 'GET', `${base}/aggregate?${new URLSearchParams({collection: 'notes', pipeline: 'SELECT COUNT(*) AS n FROM notes'})}`);
    assert.deepStrictEqual([query.status, query.body.items, query.body.count], [200, [{n: 2}], null]);
    const deleted = await control(world, 'GET', `${base}/aggregate?${new URLSearchParams({collection: 'notes', pipeline: 'DELETE FROM notes'})}`);
    assert.deepStrictEqual([deleted.status, deleted.body.error], [400, 'only what one SELECT gives is read here, and this page changes nothing for now: that statement gives no rows']);

    // Its address on the page is one the page knows: Files, and the file browsed under it
    const shown = await fetch_host({port: world.control_port, host: '127.0.0.1', path: `/remotes/laptop/files/browse?path=${encodeURIComponent(file)}&collection=notes`, headers: {accept: 'text/html'}});
    assert.strictEqual(shown.status, 200);
    assert.ok(shown.body.includes('<div id="app">'), shown.body.slice(0, 200));
});

// What is not read is said, before the machine is asked when serviceman knows it, and with
// what the agent found when it does not
test('a file that is gone, a folder, a file that is no SQLite, a machine away and a change are refused', {skip: SKIPPED}, async function (t) {
    const world = await world_start(t, ['phone']);
    const file = shop_make(world.files);
    fs.writeFileSync(path.join(world.files, 'notes.db'), 'These are notes, not a database.\n'.repeat(100));
    const asked = [
        ['GET', base_of(path.join(world.files, 'gone.db')), undefined],
        ['GET', `${base_of(path.join(world.files, 'gone.db'))}/collections`, undefined],
        ['GET', base_of(world.files), undefined],
        ['GET', base_of(path.join(world.files, 'notes.db')), undefined],
        ['GET', `${base_of(path.join(world.files, 'notes.db'))}/collections`, undefined],
        ['GET', `/api/v1/remotes/laptop/sqlite/${encodeURIComponent(`${file}\0`)}/browse`, undefined],
        ['GET', `/api/v1/remotes/phone/sqlite/${encodeURIComponent(file)}/browse/collections`, undefined],
        ['GET', `/api/v1/remotes/nope/sqlite/${encodeURIComponent(file)}/browse/collections`, undefined],
        ['POST', `${base_of(file)}/documents`, {collection: 'notes', document: '{}'}],
        ['POST', `${base_of(file)}/documents/drop`, {collection: 'notes'}],
        ['GET', `${base_of(file)}/tables`, undefined],
    ];
    const said = [];
    for (const [method, url, body] of asked) {
        const answer = await control(world, method, url, body);
        said.push(`${answer.status} ${answer.body.error}`);
    }
    assert.deepStrictEqual(said, [
        `404 there is no file at ${path.join(world.files, 'gone.db')}`,
        `404 there is no file at ${path.join(world.files, 'gone.db')}`,
        `400 ${world.files} is a folder: a SQLite database is a file`,
        '400 this file is no SQLite database: file is not a database',
        '400 this file is no SQLite database: file is not a database',
        '400 the address names a file by its path, of at most 4096 characters',
        '409 phone is offline: shop.db is read again when it is back',
        '404 no remote named "nope"',
        '405 its data is read here alone for now: changing it comes in a later step',
        `404 no such door: ${base_of(file)}/documents/drop`,
        `404 no such door: ${base_of(file)}/tables`,
    ]);
    assert.strictEqual(fs.existsSync(path.join(world.files, 'shop.db-journal')), false);
});

// A query that would run for hours holds a reader of its own, never the agent: the machine's
// files are listed meanwhile as quickly as ever, and the query is stopped at its 20 s
test('while a slow query runs, the machine\'s agent answers everything else at once', {skip: SKIPPED, timeout: 90000}, async function (t) {
    const world = await world_start(t);
    const file = shop_make(world.files);
    const base = `/api/v1/remotes/laptop/sqlite/${encodeURIComponent(file)}/browse`;
    const time0 = Date.now();
    let settled = false;
    const slow = control(world, 'GET', `${base}/aggregate?${new URLSearchParams({collection: 'notes', pipeline: ENDLESS})}`).finally(function () {
        settled = true;
    });
    await timers.setTimeout(1000);
    const listed = [];
    for (let i = 0; i < 5; i++) {
        const asked_at = Date.now();
        const answer = await control(world, 'GET', `/api/v1/remotes/laptop/fs?path=${encodeURIComponent(world.files)}`);
        listed.push([answer.status, answer.body.items.map(v => v.name).includes('shop.db'), (Date.now() - asked_at) < 1000]);
        await timers.setTimeout(500);
    }
    assert.strictEqual(settled, false, 'the slow query is still running');
    assert.deepStrictEqual(listed, Array(5).fill([200, true, true]));
    const stopped = await slow;
    assert.deepStrictEqual([stopped.status, stopped.body.error], [400, 'it took longer than 20 s, and the agent stopped it: an index on what it filters or sorts by makes it quick']);
    assert.ok((Date.now() - time0) < 30000);
});

// A file's data on the laptop, its path one word of the address
function base_of(file)
{
    return `/api/v1/remotes/laptop/sqlite/${encodeURIComponent(file)}/browse`;
}

// `others` are machines of the config beside the laptop, with no agent: offline
async function world_start(t, others)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-files-'));
    const out = {dir, files: path.join(dir, 'files'), agent_log: path.join(dir, 'agent.log')};
    fs.mkdirSync(out.files);
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'laptop', token: TOKEN}].concat((others || []).map((v, i) => ({name: v, token: `token-of-${v}-${i}-0123456789abcdef`}))),
        services: [],
    }, null, 4));
    const app = app_from_config(await profile_from_db(config_path));
    app.state_dir = path.join(dir, 'state');
    const servers = await server_start(app);
    Object.assign(out, {app, servers, control_port: servers.control.address().port});
    const log = fs.openSync(out.agent_log, 'w');
    const env = Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: path.join(dir, 'agent'), SERVICEMAN_LOG_TIME: 'off'});
    out.agent = child_process.spawn(process.execPath, [AGENT, '--url', `http://127.0.0.1:${out.control_port}`, '--token', TOKEN, '--docker', 'false', '--peer-port', '0'], {stdio: ['ignore', log, log], env});
    t.after(function () {
        out.agent.kill();
        for (const remote of app.remotes) {
            if (remote.state.socket !== null) {
                remote.state.socket.destroy();
            }
        }
        for (const door of [servers.server, servers.control, servers.socket]) {
            if ((door !== null) && (door !== undefined)) {
                door.close();
                door.closeAllConnections();
            }
        }
        fs.closeSync(log);
        fs.rmSync(dir, {recursive: true, force: true});
    });
    const laptop = app.remote_by_name.laptop;
    await wait_until(() => (laptop.state.phase === 'online') && (laptop.state.resources !== null), 15000);
    return out;
}

async function control(world, method, path_asked, value)
{
    const body = (value === undefined) ? undefined : JSON.stringify(value);
    const headers = (body === undefined) ? {} : {'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body))};
    const answer = await fetch_host({port: world.control_port, host: '127.0.0.1', path: path_asked, method, headers, body});
    return {status: answer.status, body: JSON.parse(answer.body)};
}

async function wait_until(ready, timeout_ms)
{
    const deadline = Date.now() + timeout_ms;
    while (ready() === false) {
        if (Date.now() >= deadline) {
            throw new Error('the condition never came true');
        }
        await timers.setTimeout(25);
    }
}

// A small file: two notes, one of them with an integer past 2^53, and a view
function shop_make(dir)
{
    const {DatabaseSync} = require('node:sqlite');
    const out = path.join(dir, 'shop.db');
    const db = new DatabaseSync(out);
    db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT, big INTEGER); CREATE VIEW recent AS SELECT * FROM notes WHERE id > 1;');
    db.prepare('INSERT INTO notes VALUES (?, ?, ?), (?, ?, ?)').run(1, 'hello', 1, 2, 'world', 9007199254740993n);
    db.close();
    return out;
}
