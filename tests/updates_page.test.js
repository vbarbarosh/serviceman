const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const fs = require('fs');
const net = require('net');
const os = require('os');
const page_fetch_begin = require('./page_fetch_begin');
const path = require('path');
const server_start = require('../src/main/src/helpers/server_start');
const test = require('node:test');
const timers = require('timers/promises');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');

// Install pressed on Updates while serviceman was restarting said "the answer never came back",
// and nothing more: not why, not whether anything was installed, not what to do. Now the press
// is looked into once serviceman is back, and what came of it is said.
test('Install pressed while serviceman is away says, once it is back, that nothing began', async function () {
    const section = await section_of({answering: true});
    const running = await serviceman_start();
    let page_fetch_end = page_fetch_begin(await port_away());
    try {
        const pressed = section.start();
        await timers.setTimeout(300);
        assert.deepStrictEqual({looking: section.looking, sending: section.sending, error: section.error}, {looking: true, sending: true, error: null}, 'looking while serviceman is away');

        // serviceman back: no install began, and the press is to be made again
        page_fetch_end();
        page_fetch_end = page_fetch_begin(running.port);
        await pressed;
        assert.deepStrictEqual({looking: section.looking, sending: section.sending, mode: section.mode, batch: section.batch}, {looking: false, sending: false, mode: 'pick', batch: null});
        assert.strictEqual(section.error, 'Not started: serviceman was away when Install was pressed, a restart most often. It is back now: Install again.');
    }
    finally {
        section.closed = true;
        clearTimeout(section.timer);
        page_fetch_end();
        running.end();
    }
});

test('Install whose answer was lost, but which began, shows the install', async function () {
    const section = await section_of({answering: true});
    const running = await serviceman_start();
    let page_fetch_end = page_fetch_begin(await port_away());
    try {
        const pressed = section.start();
        await timers.setTimeout(300);
        // It landed before serviceman went: serviceman has it when it answers again
        running.app.apt_all = {remotes: ['vps1'], held: null, started_at: Date.now(), ended_at: null};
        page_fetch_end();
        page_fetch_end = page_fetch_begin(running.port);
        await pressed;
        assert.deepStrictEqual({mode: section.mode, error: section.error, forgotten: section.forgotten, rows: section.batch.remotes.map(v => v.name)}, {mode: 'run', error: null, forgotten: false, rows: ['vps1']});
    }
    finally {
        section.closed = true;
        clearTimeout(section.timer);
        page_fetch_end();
        running.end();
    }
});

// The machine serviceman runs on goes last because an upgrade of Docker there restarts
// serviceman, which keeps no install over a restart. Its answer with no install broke the list
// that followed it; now the rows stay as last seen, said as not followed.
test('an install serviceman no longer has after a restart leaves its rows as last seen', async function () {
    const section = await section_of({answering: true});
    const running = await serviceman_start();
    const page_fetch_end = page_fetch_begin(running.port);
    try {
        running.app.apt_all = {remotes: ['laptop', 'vps1'], held: 'laptop', started_at: Date.now(), ended_at: null};
        running.app.remote_by_name.vps1.state.apt = {phase: 'ok', lines: ['done'], started_at: Date.now(), ended_at: Date.now(), error: null, containers: null};
        running.app.remote_by_name.laptop.state.apt = {phase: 'waiting', lines: [], started_at: null, ended_at: null, error: null, containers: null};
        await section.read();
        assert.strictEqual(section.mode, 'run');

        running.app.apt_all = null;
        await section.read();
        assert.deepStrictEqual({forgotten: section.forgotten, ended: section.ended, phases: section.batch.remotes.map(v => `${v.name} ${v.phase}`), foot: section.run_foot.map(v => v.text)}, {forgotten: true, ended: true, phases: ['laptop lost', 'vps1 ok'], foot: ['Installed on 2', '1 done', '1 not followed', 'a row opens its machine\'s Configure tab, with every line']});
    }
    finally {
        section.closed = true;
        clearTimeout(section.timer);
        page_fetch_end();
        running.end();
    }
});

test('serviceman away for three minutes is said so, and not taken for an answer', async function () {
    const answered_again = (await import(path.join(PUBLIC, 'answered_again.js'))).default;
    const now_before = Date.now;
    let skipped = 0;
    // Each look a minute later than the one before
    Date.now = function () {
        return now_before() + skipped;
    };
    try {
        const said = await answered_again(async function () {
            skipped += 60000;
            throw new TypeError('fetch failed');
        }, () => false);
        assert.deepStrictEqual({said, skipped}, {said: null, skipped: 180000}, 'three looks a minute apart, and the three minutes are up');
        assert.strictEqual(await answered_again(() => Promise.reject(new TypeError('fetch failed')), () => true), null, 'nor waits once the list is closed');
    }
    finally {
        Date.now = now_before;
    }
});

// A machine online with these updates, as the status says it; more: fields put over it
function online(updates, more)
{
    return Object.assign({name: 'vps1', title: 'Hetzner, Falkenstein', phase: 'online', agent_version: '1.40.0', agent_built: null, left_at: null, machine: {os: 'Debian 12', can: ['apt'], updates}}, more);
}

// What a row says: its pill and its tone, its chip, whether it ticks, what helps there
function said(row)
{
    return [row.pill, row.pill_tone, row.group, row.able, row.act];
}

// The page as vue drives it: its data, props, methods and computed values on one object
async function section_of(props)
{
    const section = (await import(path.join(PUBLIC, 'updates_page.js'))).default;
    const out = Object.assign(section.data(), props, {state: {remotes: [], canvas: null, agent_built: null}, $emit: function () {}});
    for (const [name, method] of Object.entries(section.methods)) {
        out[name] = method.bind(out);
    }
    for (const [name, compute] of Object.entries(section.computed)) {
        Object.defineProperty(out, name, {get: compute.bind(out)});
    }
    return out;
}

async function serviceman_start()
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-updates-'));
    const config = config_from_json({
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'laptop', token: 'cccccccccccccccccccccccccccccccc'}, {name: 'vps1', token: 'dddddddddddddddddddddddddddddddd'}],
        services: [],
    }, dir);
    const app = app_from_config(config);
    app.state_dir = dir;
    const servers = await server_start(app);
    return {
        app,
        port: servers.control.address().port,
        end: function () {
            servers.control.close();
            servers.server.close();
            fs.rmSync(dir, {recursive: true, force: true});
        },
    };
}

// The port of a server that has closed: serviceman away
async function port_away()
{
    const away = net.createServer().listen(0, '127.0.0.1');
    await new Promise(v => away.once('listening', v));
    const port = away.address().port;
    await new Promise(v => away.close(v));
    return port;
}

// Each machine as the list draws it: what waits, whether Install can take it, and what helps
// where it cannot
test('a row says what waits on its machine, and whether Install can take it', async function () {
    const {updates_row} = await import(path.join(PUBLIC, 'updates_page.js'));
    const now = Date.UTC(2026, 10, 20, 12, 0);
    const hour = 3600000;
    assert.deepStrictEqual(said(updates_row(online({pending: 12, security: 3, held: 0, reboot: false, lists_at: now - 3*hour}), null, 'server', now)), ['12 to install · 3 security', 'bad', 'install', true, null]);
    assert.deepStrictEqual(said(updates_row(online({pending: 4, security: 0, held: 2, reboot: false, lists_at: now - 2*hour}), null, 'server', now)), ['4 to install', 'acc', 'install', true, null]);
    assert.deepStrictEqual(said(updates_row(online({pending: 0, security: 0, held: 11, reboot: false, lists_at: now - hour}), null, 'server', now)), ['up to date', 'run', 'current', false, null]);
    assert.deepStrictEqual(said(updates_row(online({pending: 0, security: 0, held: null, reboot: true, lists_at: now - 5*hour}), null, 'server', now)), ['wants a restart', 'busy', 'needs', false, 'restart']);
    assert.deepStrictEqual(said(updates_row(online({pending: 0, security: 0, held: null, reboot: false, lists_at: now - 9*24*hour}), null, 'server', now)), ['lists 9 days old', 'busy', 'needs', false, 'fetch']);
    const away = updates_row(online(null, {phase: 'offline', left_at: now - hour}), null, 'server', now);
    assert.deepStrictEqual(said(away).concat([away.tone, away.lists, away.held]), ['offline', 'bad', 'offline', false, null, 'bad', '—', null]);
    const old = updates_row(online(null, {machine: {os: 'Debian 12', can: [], updates: null}}), null, 'server', now);
    assert.deepStrictEqual(said(old).concat([old.line]), ['not said', 'idle', 'needs', false, null, 'its agent is from before updates']);
});

// The machine serviceman runs on goes last, alone: its row says so before Install is pressed
test('the machine serviceman runs on says it goes last, alone', async function () {
    const {updates_row} = await import(path.join(PUBLIC, 'updates_page.js'));
    const now = Date.now();
    const remote = {name: 'laptop', title: 'this computer', phase: 'online', agent_version: '1.40.0', left_at: null, serviceman_here: true, machine: {os: 'Ubuntu 24.04', can: ['apt'], updates: {pending: 4, security: 0, held: 2, reboot: false, lists_at: now}}};
    const row = updates_row(remote, null, 'laptop', now);
    assert.deepStrictEqual([row.line, row.own, row.able], ['this computer · goes last, alone', true, true]);
    assert.strictEqual(updates_row(Object.assign({}, remote, {title: 'laptop'}), null, 'laptop', now).line, 'goes last, alone', 'a title that is its name is not said twice');
});
