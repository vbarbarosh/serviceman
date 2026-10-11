const assert = require('assert');
const docker_log_reader = require('../src/agent/src/docker_log_reader');
const fs = require('fs');
const logline_files = require('../src/agent/src/logline_files');
const logline_spool = require('../src/agent/src/logline_spool');
const logline_time_strip = require('../src/agent/src/logline_time_strip');
const os = require('os');
const path = require('path');
const test = require('node:test');
const time_utc_nanos = require('../src/agent/src/time_utc_nanos');
const timers = require('timers/promises');

test('a stamp is the same instant in UTC to the nanosecond, so two of them compare as text', function () {
    assert.strictEqual(time_utc_nanos('2026-09-25T18:17:09.979123456Z'), '2026-09-25T18:17:09.979123456Z');
    assert.strictEqual(time_utc_nanos('2026-09-25T18:17:09.98Z'), '2026-09-25T18:17:09.980000000Z', 'docker drops trailing zeros');
    assert.strictEqual(time_utc_nanos('2026-09-25T22:17:09.979+03:00'), '2026-09-25T19:17:09.979000000Z');
    assert.strictEqual(time_utc_nanos('2026-09-25T22:17:09+0300'), '2026-09-25T19:17:09.000000000Z');
    assert.strictEqual(time_utc_nanos('2026-02-30T00:00:00Z'), null);
    const local = new Date(2026, 8, 25, 22, 49, 19);
    assert.strictEqual(time_utc_nanos('2026-09-25T22:49:19'), `${local.toISOString().slice(0, 19)}.000000000Z`, 'no zone is local time here');
});

test('a line that starts with its own time gives it up; one that does not is left as it is', function () {
    const cases = [
        ['2026/09/25 22:47:45 [c7t0xb1m][worker_begin]', '[c7t0xb1m][worker_begin]'],
        ['2026/09/25 22:47:45[c7t0xb1m][worker_begin]', '[c7t0xb1m][worker_begin]'],
        ['2026-09-25T19:48:10.059Z [c7t0xb1m][worker_begin]', '[c7t0xb1m][worker_begin]'],
        ['2026-09-25T19:48:10.059Z[c7t0xb1m][worker_begin]', '[c7t0xb1m][worker_begin]'],
        ['[2026/09/25 22:47:45][c7t0xb1m][worker_begin]', '[c7t0xb1m][worker_begin]'],
        ['[2026-09-25T19:48:10.059Z][c7t0xb1m][worker_begin] x=1', '[c7t0xb1m][worker_begin] x=1'],
        ['[2026-09-25T19:48:10.059Z] started', 'started'],
    ];
    for (const [given, left] of cases) {
        const stripped = logline_time_strip(given);
        assert.strictEqual(stripped.line, left, given);
        assert.notStrictEqual(stripped.time, null, given);
    }
    assert.strictEqual(logline_time_strip('2026-09-25T19:48:10.059Z [c7t0xb1m][x]').time, '2026-09-25T19:48:10.059000000Z');
    assert.strictEqual(logline_time_strip('2026/09/25 22:47:45 [x][y]').time, `${new Date(2026, 8, 25, 22, 47, 45).toISOString().slice(0, 19)}.000000000Z`, 'local on this machine');
    // Not a real time, not followed by a tag, or not at the start: the line stays whole
    for (const line of ['[2026/13/45 99:00:00][c7t0xb1m][x]', '2026/09/25 22:47:45 started', 'at 2026/09/25 22:47:45 [x][y]', 'GET / 200']) {
        assert.deepStrictEqual(logline_time_strip(line), {time: null, line}, line);
    }
});

test('docker\'s log stream comes apart into lines, in order, with the stream each came on', function () {
    const reader = docker_log_reader(false);
    const whole = Buffer.concat([
        frame(1, '2026-09-25T18:17:09.1Z first\n'),
        frame(2, '2026-09-25T18:17:09.2Z an error\n'),
        // A long line docker cut in two, each piece stamped
        frame(1, '2026-09-25T18:17:09.3Z long '),
        frame(1, '2026-09-25T18:17:09.4Z line\n'),
    ]);
    // Frames arrive in pieces of any size
    const entries = [];
    for (let i = 0; i < whole.length; i += 7) {
        entries.push(...reader.push(whole.subarray(i, i + 7)));
    }
    entries.push(...reader.end());
    assert.deepStrictEqual(entries, [
        {stream: 'stdout', at: '2026-09-25T18:17:09.100000000Z', text: 'first'},
        {stream: 'stderr', at: '2026-09-25T18:17:09.200000000Z', text: 'an error'},
        {stream: 'stdout', at: '2026-09-25T18:17:09.300000000Z', text: 'long line'},
    ]);

    const tty = docker_log_reader(true);
    const lines = tty.push(Buffer.from('2026-09-25T18:17:09.1Z one\r\n2026-09-25T18:17:09.2Z tw'));
    lines.push(...tty.push(Buffer.from('o\r\n2026-09-25T18:17:09.3Z three')));
    lines.push(...tty.end());
    assert.deepStrictEqual(lines.map(v => [v.stream, v.text]), [['stdout', 'one\r'], ['stdout', 'two\r'], ['stdout', 'three']]);
});

// One frame of docker's stream: which stream, how long, then the bytes
function frame(stream, text)
{
    return Buffer.concat([Buffer.from([stream, 0, 0, 0]), size_of(text), Buffer.from(text)]);
}

function record(src, at, line)
{
    return {src, at, time: at, labels: {container: src}, line};
}

function size_of(text)
{
    const out = Buffer.alloc(4);
    out.writeUInt32BE(Buffer.byteLength(text));
    return out;
}

test('the spool keeps what it synced across a crash, sends a batch the same until it is acked, and knows where each container stood', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spool-'));
    let spool = logline_spool(dir, {cap_bytes: 1e9, segment_bytes: 400, sync_ms: 60000});
    spool.append(record('a', '2026-09-25T18:00:01.000000000Z', 'one'));
    spool.append(record('a', '2026-09-25T18:00:01.000000000Z', 'two'));
    spool.append(record('b', '2026-09-25T18:00:02.000000000Z', 'three'));
    spool.flush();
    // In memory only: a crash here loses it, and docker is asked for it again
    spool.append(record('a', '2026-09-25T18:00:03.000000000Z', 'not synced'));
    spool = logline_spool(dir, {cap_bytes: 1e9, segment_bytes: 400, sync_ms: 60000});
    assert.deepStrictEqual(spool.cursor('a'), {at: '2026-09-25T18:00:01.000000000Z', n: 2}, 'two lines share that stamp; both are here');
    assert.deepStrictEqual(spool.cursor('b'), {at: '2026-09-25T18:00:02.000000000Z', n: 1});
    assert.strictEqual(spool.stats().waiting_lines, 3);

    // A torn last line, as a crash in the middle of a write leaves it
    const segment = fs.readdirSync(dir).find(v => v.endsWith('.jsonl'));
    fs.appendFileSync(path.join(dir, segment), '{"seq":4,"src":"a","at":"2026');
    spool = logline_spool(dir, {cap_bytes: 1e9, segment_bytes: 400, sync_ms: 60000});
    assert.strictEqual(spool.stats().waiting_lines, 3, 'what was never whole was never collected');

    const first = spool.batch(2, 1e6);
    assert.deepStrictEqual([first.first, first.last, JSON.parse(first.body).map(v => v.line)], [1, 2, ['one', 'two']]);
    // More lines arrive, and the batch is asked for again — a send that failed, a restart
    spool.append(record('c', '2026-09-25T18:00:04.000000000Z', 'four'));
    spool.flush();
    assert.strictEqual(spool.batch(10, 1e6).body, first.body, 'the same batch, byte for byte');
    spool = logline_spool(dir, {cap_bytes: 1e9, segment_bytes: 400, sync_ms: 60000});
    const again = spool.batch(10, 1e6);
    assert.strictEqual(again.body, first.body, 'and after a restart as well');
    spool.ack(again);
    const next = spool.batch(10, 1e6);
    assert.deepStrictEqual(JSON.parse(next.body).map(v => v.line), ['three', 'four']);
    assert.strictEqual(spool.stats().waiting_lines, 2);

    // Past its segment size the spool moves to a new file, and a segment nothing waits in goes
    for (let i = 0; i < 6; i++) {
        spool.append(record('a', `2026-09-25T18:00:1${i}.000000000Z`, `line ${i}`));
        spool.flush();
    }
    spool.ack(next);
    let cut = spool.batch(100, 1e6);
    while (cut !== null) {
        spool.ack(cut);
        cut = spool.batch(100, 1e6);
    }
    assert.strictEqual(spool.stats().waiting_lines, 0);
    assert.strictEqual(fs.readdirSync(dir).filter(v => v.endsWith('.jsonl')).length, 1, 'only the segment still taking records is left');
    spool.close();
    // Where each container stood survives its segments
    spool = logline_spool(dir, {cap_bytes: 1e9, segment_bytes: 400, sync_ms: 60000});
    assert.deepStrictEqual(spool.cursor('a'), {at: '2026-09-25T18:00:15.000000000Z', n: 1});
    assert.deepStrictEqual(spool.cursor('b'), {at: '2026-09-25T18:00:02.000000000Z', n: 1});
    assert.deepStrictEqual(spool.cursor('c'), {at: '2026-09-25T18:00:04.000000000Z', n: 1});
    spool.close();
});

test('a spool at its cap says so, and says when there is room again', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spool-'));
    const spool = logline_spool(dir, {cap_bytes: 600, segment_bytes: 200, sync_ms: 60000});
    let i = 0;
    while (spool.full() === false) {
        spool.append({src: 'a', at: `2026-09-25T18:00:${String(10 + i).padStart(2, '0')}.000000000Z`, time: null, labels: {}, line: `line ${i}`});
        spool.flush();
        i += 1;
    }
    let roomy = false;
    spool.room().then(function () {
        roomy = true;
    });
    let cut = spool.batch(3, 1e6);
    spool.ack(cut);
    await new Promise(v => setImmediate(v));
    while ((roomy === false) && ((cut = spool.batch(3, 1e6)) !== null)) {
        spool.ack(cut);
        await new Promise(v => setImmediate(v));
    }
    assert.strictEqual(roomy, true);
    assert.strictEqual(spool.full(), false);
    spool.close();
});

test('a batch that ends exactly where its segment ends leaves the next one ready', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spool-'));
    const spool = logline_spool(dir, {cap_bytes: 1e9, segment_bytes: 300, sync_ms: 60000});
    for (let i = 0; i < 9; i++) {
        spool.append({src: 'a', at: `2026-09-25T18:00:0${i}.000000000Z`, time: null, labels: {}, line: `line ${i}`});
        spool.flush();
    }
    const segments = fs.readdirSync(dir).filter(v => v.endsWith('.jsonl')).sort();
    const in_first = fs.readFileSync(path.join(dir, segments[0]), 'utf8').split('\n').filter(v => v !== '').length;
    const cut = spool.batch(in_first, 1e6);
    assert.strictEqual(cut.count, in_first, 'the whole first segment, and nothing past it');
    spool.ack(cut);
    const lines = [];
    let next = spool.batch(100, 1e6);
    while (next !== null) {
        lines.push(...JSON.parse(next.body).map(v => v.line));
        spool.ack(next);
        next = spool.batch(100, 1e6);
    }
    assert.deepStrictEqual(lines, Array.from({length: 9 - in_first}, (v, i) => `line ${i + in_first}`));
    spool.close();
});

test('whatever order appends, syncs, batches, acks and restarts come in, every synced line is sent once, in order', function () {
    for (let seed = 1; seed <= 40; seed++) {
        const random = random_make(seed);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spool-'));
        const options = {cap_bytes: 1e9, segment_bytes: 200 + Math.floor(random()*800), sync_ms: 60000};
        let spool = logline_spool(dir, options);
        const synced = [];
        let pending = [];
        const sent = [];
        let n = 0;
        for (let step = 0; step < 400; step++) {
            const roll = random();
            if (roll < 0.45) {
                const line = `line ${n}`;
                n += 1;
                spool.append({src: 'a', at: `2026-09-25T18:00:00.${String(n).padStart(9, '0')}Z`, time: null, labels: {}, line});
                pending.push(line);
            }
            else if (roll < 0.6) {
                spool.flush();
                synced.push(...pending);
                pending = [];
            }
            else if (roll < 0.85) {
                const cut = spool.batch(1 + Math.floor(random()*7), 1e6);
                if ((cut !== null) && (random() < 0.8)) {
                    spool.ack(cut);
                    sent.push(...JSON.parse(cut.body).map(v => v.line));
                }
            }
            else if (roll < 0.95) {
                // A crash: what was not synced is gone, and the next lines take its seqs
                spool = logline_spool(dir, options);
                pending = [];
            }
        }
        spool.flush();
        synced.push(...pending);
        for (let cut = spool.batch(50, 1e6); cut !== null; cut = spool.batch(50, 1e6)) {
            spool.ack(cut);
            sent.push(...JSON.parse(cut.body).map(v => v.line));
        }
        assert.deepStrictEqual(sent, synced, `seed ${seed}`);
        spool.close();
    }
});

// Everything the spool holds, sent: each line as "file: line"
function spool_drain(spool, logs)
{
    spool.flush();
    const out = [];
    for (let cut = spool.batch(1000, 1e7); cut !== null; cut = spool.batch(1000, 1e7)) {
        spool.ack(cut);
        out.push(...JSON.parse(cut.body).map(v => `${v.labels.file.slice(logs.length + 1)}: ${v.line}`));
    }
    return out;
}

function nothing()
{
}

// A random that goes the same way every time for the same seed, so a failure can be run again
function random_make(seed)
{
    let state = seed;
    return function () {
        state = (state*1103515245 + 12345) % 2147483648;
        return state/2147483648;
    };
}

test('a folder is read a line at a time: from where it ends when first watched, new files from their start, never twice', async function () {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'files-'));
    const was = process.env.SERVICEMAN_AGENT_DIR;
    process.env.SERVICEMAN_AGENT_DIR = path.join(home, 'agent');
    try {
        const logs = path.join(home, 'logs');
        fs.mkdirSync(logs);
        fs.writeFileSync(path.join(logs, 'app.log'), 'from before the floor\n');
        fs.writeFileSync(path.join(logs, 'old.log.gz'), 'packed');
        fs.writeFileSync(path.join(logs, 'notes.txt'), 'not a log by the pattern\n');
        const spool = logline_spool(path.join(home, 'spool'), {cap_bytes: 1e9, sync_ms: 60000});
        const ctx = {spool, host: 'box', dirs: [{path: path.join(logs, '*.log'), service: null}], floor: '2026-09-26T00:00:00.000000000Z', say: nothing};
        let files = logline_files(ctx);
        await timers.setTimeout(50);
        assert.deepStrictEqual(spool_drain(spool, logs), [], 'what was there when the folder was first watched is from before');

        fs.appendFileSync(path.join(logs, 'app.log'), 'one\n[2026-09-26T10:00:00.000Z][c7t0xb1m][worker_begin]\nhalf a li');
        fs.writeFileSync(path.join(logs, 'new.log'), 'first of new\n');
        await timers.setTimeout(1200);
        assert.deepStrictEqual(spool_drain(spool, logs), ['app.log: one', 'app.log: [c7t0xb1m][worker_begin]', 'new.log: first of new']);

        // The half line waits for its newline; a restart goes on from where it stood
        files.stop();
        fs.appendFileSync(path.join(logs, 'app.log'), 'ne\n');
        files = logline_files(ctx);
        await timers.setTimeout(50);
        assert.deepStrictEqual(spool_drain(spool, logs), ['app.log: half a line']);

        // Truncated in place: read again from its start
        fs.writeFileSync(path.join(logs, 'app.log'), 'after truncate\n');
        await timers.setTimeout(1200);
        assert.deepStrictEqual(spool_drain(spool, logs), ['app.log: after truncate']);
        files.stop();

        // Switched off and on again: a new floor, and nothing written in between is read
        fs.appendFileSync(path.join(logs, 'app.log'), 'while it was off\n');
        files = logline_files(Object.assign({}, ctx, {floor: '2026-09-26T12:00:00.000000000Z'}));
        await timers.setTimeout(50);
        fs.appendFileSync(path.join(logs, 'app.log'), 'after the new floor\n');
        await timers.setTimeout(1200);
        assert.deepStrictEqual(spool_drain(spool, logs), ['app.log: after the new floor']);
        files.stop();
        spool.close();
    }
    finally {
        if (was === undefined) {
            delete process.env.SERVICEMAN_AGENT_DIR;
        }
        else {
            process.env.SERVICEMAN_AGENT_DIR = was;
        }
    }
});
