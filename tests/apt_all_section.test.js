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

// Install pressed on Remotes while serviceman was restarting said "the answer never came back",
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
        assert.deepStrictEqual({forgotten: section.forgotten, ended: section.ended, phases: section.batch.remotes.map(v => `${v.name} ${v.phase}`), summary: section.summary}, {forgotten: true, ended: true, phases: ['laptop lost', 'vps1 ok'], summary: '1 done · 1 not followed'});
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

// The section as vue drives it: its data, props, methods and computed values on one object
async function section_of(props)
{
    const section = (await import(path.join(PUBLIC, 'apt_all_section.js'))).default;
    const out = Object.assign(section.data(), props, {remotes: [], $emit: function () {}});
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-apt-all-'));
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
