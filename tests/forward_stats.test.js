const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const child_process = require('child_process');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const forward_join = require('../src/main/src/helpers/forward_join');
const forward_totals_apply = require('../src/main/src/helpers/forward_totals_apply');
const forward_totals_path = require('../src/main/src/helpers/forward_totals_path');
const forward_totals_read = require('../src/main/src/helpers/forward_totals_read');
const forward_totals_write = require('../src/main/src/helpers/forward_totals_write');
const forwards_sample = require('../src/main/src/helpers/forwards_sample');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const timers = require('timers/promises');
const view_from_forward = require('../src/main/src/helpers/view_from_forward');

const MAIN = path.join(__dirname, '..', 'src', 'main', 'index.js');
const LOKI = {label: 'loki', from: {remote: 'vps1', port: 3100}, to: {remote: 'laptop', port: 9999}};
const IDLE = {label: 'idle', from: {remote: 'vps1', port: 3200}, to: {remote: 'laptop', port: 9998}};
// A whole number of buckets, so the first look opens a bucket at its start
const TIME0 = 1700000000000;

test('a forward\'s speed is what moved over the last three seconds, and 0 once it is idle', function () {
    const app = app_new([LOKI]);
    const counts = forward_join.counts(app, 'loki');
    forwards_sample(app, TIME0);
    assert.deepStrictEqual([counts.speed_sent, counts.speed_back], [0, 0], 'one look is no speed');
    for (let i = 1; i <= 3; ++i) {
        counts.bytes_sent += 3000;
        counts.bytes_back += 300;
        forwards_sample(app, TIME0 + i*1000);
    }
    assert.deepStrictEqual([counts.speed_sent, counts.speed_back], [3000, 300]);
    // A burst in the last second is a third of it, averaged over three
    counts.bytes_sent += 9000;
    forwards_sample(app, TIME0 + 4000);
    assert.strictEqual(counts.speed_sent, 5000);
    for (let i = 5; i <= 7; ++i) {
        forwards_sample(app, TIME0 + i*1000);
    }
    assert.deepStrictEqual([counts.speed_sent, counts.speed_back], [0, 0], 'three quiet seconds are no speed');
    const view = view_from_forward(app, app.config.forwards[0]);
    assert.deepStrictEqual([view.speed_sent, view.speed_back], [0, 0]);
});

test('a forward\'s history is one average per 5 seconds, oldest first, ten minutes of them', function () {
    const app = app_new([LOKI, IDLE]);
    const counts = forward_join.counts(app, 'loki');
    // The first bucket carries 1000 bytes a second sent and 100 back, the second 2000 and 0
    forwards_sample(app, TIME0);
    for (let i = 1; i <= 10; ++i) {
        counts.bytes_sent += ((i <= 5) ? 1000 : 2000);
        counts.bytes_back += ((i <= 5) ? 100 : 0);
        forwards_sample(app, TIME0 + i*1000);
    }
    let view = view_from_forward(app, app.config.forwards[0]);
    assert.deepStrictEqual(view.history_sent, [1000, 2000], 'the bucket in progress is not in it');
    assert.deepStrictEqual(view.history_back, [100, 0]);
    const idle = view_from_forward(app, app.config.forwards[1]);
    assert.deepStrictEqual([idle.speed_sent, idle.speed_back, idle.history_sent, idle.history_back], [0, 0, [0, 0], [0, 0]], 'no traffic is a zero per bucket');

    // A timer that stalled for 15 seconds spreads what moved over the three buckets it missed
    counts.bytes_sent += 30000;
    forwards_sample(app, TIME0 + 25000);
    view = view_from_forward(app, app.config.forwards[0]);
    assert.deepStrictEqual(view.history_sent.slice(2), [2000, 2000, 2000]);

    // Twelve minutes later only the last ten are kept
    for (let i = 26; i <= 26 + 12*60; ++i) {
        counts.bytes_sent += i;
        forwards_sample(app, TIME0 + i*1000);
    }
    view = view_from_forward(app, app.config.forwards[0]);
    assert.strictEqual(view.history_sent.length, 120);
    assert.strictEqual(view.history_back.length, 120);
    assert.strictEqual(view_from_forward(app, app.config.forwards[1]).history_sent.length, 120);
    // The newest bucket closed at 745 s, with what came in the seconds 741 to 745
    assert.strictEqual(view.history_sent[119], 743);
    assert.strictEqual(view.history_sent[0], 743 - 119*5);
});

test('a forward with no look yet has no speed and an empty history', function () {
    const app = app_new([LOKI]);
    const view = view_from_forward(app, app.config.forwards[0]);
    assert.deepStrictEqual([view.speed_sent, view.speed_back, view.history_sent, view.history_back], [0, 0, [], []]);
});

test('what a forward carried is on disk, and the next serviceman goes on from it', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-stats-'));
    const first = app_new([LOKI, IDLE], dir);
    const counts = forward_join.counts(first, 'loki');
    Object.assign(counts, {open: 2, total: 7, bytes_sent: 1000, bytes_back: 20000, error: 'vps1 is offline', error_at: TIME0});
    assert.strictEqual(forward_totals_write(first), true);
    assert.strictEqual(forward_totals_write(first), false, 'nothing moved, so nothing is written');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(forward_totals_path(first), 'utf8')), {
        forwards: {
            loki: {total: 7, bytes_sent: 1000, bytes_back: 20000},
            idle: {total: 0, bytes_sent: 0, bytes_back: 0},
        },
    });
    assert.deepStrictEqual(fs.readdirSync(dir), ['forward_totals.json'], 'the file is renamed into place');

    const next = app_new([LOKI], dir);
    // A connection that came in before the file was read is added to, not lost
    forward_join.counts(next, 'loki').total = 1;
    forward_totals_apply(next, forward_totals_read(next));
    const again = forward_join.counts(next, 'loki');
    assert.deepStrictEqual([again.open, again.total, again.bytes_sent, again.bytes_back, again.error], [0, 8, 1000, 20000, null]);
    // idle is out of the config: the next write leaves it out of the file
    assert.strictEqual(forward_totals_write(next), true);
    assert.deepStrictEqual(Object.keys(forward_totals_read(next)), ['loki']);
});

test('a forward totals file that does not read is a start from zero, not a failed start', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-stats-'));
    const app = app_new([LOKI], dir);
    fs.writeFileSync(forward_totals_path(app), '{ not json');
    assert.deepStrictEqual(forward_totals_read(app), {});
    assert.strictEqual(app.log_lines.some(v => /\[forward_totals_read_error\]/.test(v)), true);
    forward_totals_apply(app, {loki: {total: 'many', bytes_sent: 5}, nobody: null});
    assert.deepStrictEqual([forward_join.counts(app, 'loki').total, forward_join.counts(app, 'loki').bytes_sent], [0, 5]);
});

// The real process: it reads the file at the start and writes it again on the way out, without
// the forward taken out of the config while it was away
test('serviceman reads the forward totals at the start and writes them when it stops', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-stats-'));
    const state_dir = path.join(dir, 'state');
    const config_path = path.join(dir, 'serviceman.json');
    fs.writeFileSync(config_path, JSON.stringify(json_of([LOKI])));
    fs.mkdirSync(state_dir);
    const file = path.join(state_dir, 'forward_totals.json');
    fs.writeFileSync(file, JSON.stringify({forwards: {loki: {total: 3, bytes_sent: 10, bytes_back: 20}, gone: {total: 1, bytes_sent: 1, bytes_back: 1}}}));
    const env = Object.assign({}, process.env, {SERVICEMAN_STATE_DIR: state_dir, SERVICEMAN_LOG_DIR: 'none'});
    const child = child_process.spawn(process.execPath, [MAIN, config_path], {stdio: ['ignore', 'pipe', 'pipe'], env});
    try {
        await stdout_wait(child, /\[serviceman_listen\]/);
        // The signals are watched a few ticks after the doors open, and nothing tells when
        await timers.setTimeout(300);
        child.kill('SIGTERM');
        assert.strictEqual(await exit_wait(child), 0);
    }
    finally {
        child.kill('SIGKILL');
    }
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {forwards: {loki: {total: 3, bytes_sent: 10, bytes_back: 20}}});
});

// Every file of the test goes under a folder of its own, never into the repo's data/
function app_new(forwards, dir)
{
    const config = config_from_json(json_of(forwards), __dirname);
    const out = app_from_config(config);
    out.state_dir = ((dir === undefined) ? fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-forward-stats-')) : dir);
    return out;
}

function json_of(forwards)
{
    return {
        listen: {host: '127.0.0.1', port: 0},
        control: {host: 'serviceman.localhost', port: 0},
        remotes: [{name: 'laptop', token: 'cccccccccccccccccccccccccccccccc'}, {name: 'vps1', token: 'dddddddddddddddddddddddddddddddd'}],
        forwards,
        services: [],
    };
}

function stdout_wait(child, pattern)
{
    return new Promise(function (resolve, reject) {
        let text = '';
        child.stdout.on('data', function (chunk) {
            text += chunk.toString('utf8');
            if (pattern.test(text)) {
                resolve(text);
            }
        });
        child.on('exit', function (code) {
            reject(new Error(`serviceman exited with ${code} before ${pattern}: ${text}`));
        });
    });
}

function exit_wait(child)
{
    return new Promise(function (resolve) {
        child.on('exit', function (code) {
            resolve(code);
        });
    });
}
