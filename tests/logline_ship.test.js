const assert = require('assert');
const fs = require('fs');
const http = require('http');
const logline_aside = require('../src/agent/src/logline_aside');
const logline_ship = require('../src/agent/src/logline_ship');
const logline_spool = require('../src/agent/src/logline_spool');
const os = require('os');
const path = require('path');
const test = require('node:test');
const timers = require('timers/promises');

test('a Logline that takes one batch and refuses the next is one error, not a loop of ok and error', async function () {
    // Every other batch refused, the way new connections were after the tailnet changed
    const logline = await logline_fake(v => v % 2 === 0);
    const spool = spool_in_memory();
    const ship = ship_start(spool, logline.endpoint, 100);
    try {
        spool.add('a line of a container');
        await timers.setTimeout(3000);
    }
    finally {
        ship.stop();
        logline.close();
    }
    assert.deepStrictEqual(ship.said, ['logline_ship_error'], 'one error, and no ok while every other batch is refused');
    // 1s after a failure, then the next batch: a handful in three seconds, not a request per line
    assert.ok(logline.asked <= 6, `${logline.asked} requests in 3s`);
});

test('lines that trickle in go as one batch a gather, not a request a line', async function () {
    const logline = await logline_fake(() => true);
    const spool = spool_in_memory();
    const ship = ship_start(spool, logline.endpoint, 300);
    try {
        // A line every 30ms for a second, each waking the shipper as a synced line does
        for (let i = 0; i < 33; i++) {
            spool.add(`line ${i}`);
            ship.wake();
            await timers.setTimeout(30);
        }
        await timers.setTimeout(700);
    }
    finally {
        ship.stop();
        logline.close();
    }
    assert.strictEqual(logline.stored, 33, 'every line arrived');
    assert.ok((logline.asked >= 2) && (logline.asked <= 5), `${logline.asked} requests for 33 lines over a second, at a batch every 300ms`);
});

test('a batch that is full goes at once; the rest wait for the gather', async function () {
    const logline = await logline_fake(() => true);
    const spool = spool_in_memory();
    const ship = ship_start(spool, logline.endpoint, 5000);
    try {
        for (let i = 0; i < 1000; i++) {
            spool.add(`line ${i}`);
        }
        ship.wake();
        await timers.setTimeout(500);
        assert.deepStrictEqual([logline.asked, logline.stored], [1, 1000], 'a thousand lines are a full batch, sent without the wait');
        spool.add('one more');
        ship.wake();
        await timers.setTimeout(500);
        assert.strictEqual(logline.asked, 1, 'one line waits for the gather');
    }
    finally {
        ship.stop();
        logline.close();
    }
});

test('a batch Logline will never take is halved down to the line it refuses: that line alone is put aside, said once, and every other line arrives', async function () {
    // What Logline refuses is one line, wherever it is in a batch: 422 for what its store will
    // not take, 400 for a line it cannot read, 413 for one too big
    await Promise.all([422, 400, 413].map(async function (status) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logline-ship-'));
        const logline = await logline_fake((asked, items) => items.some(v => v.line === 'line 37') ? status : true);
        const spool = spool_on_disk(dir);
        const lines = [];
        for (let i = 0; i < 100; i++) {
            lines.push(`line ${i}`);
            spool.add(`line ${i}`);
        }
        const ship = ship_start(spool, logline.endpoint, 50, dir);
        try {
            await until(() => logline.lines.some(v => v.startsWith('[logline_batch_refused]')));
        }
        finally {
            ship.stop();
            logline.close();
            spool.close();
        }
        assert.deepStrictEqual(logline.lines.filter(v => v.startsWith('line ')), lines.filter(v => v !== 'line 37'), `${status}: every other line, once and in order`);
        assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'refused')), ['38-38.json']);
        const kept = JSON.parse(fs.readFileSync(path.join(dir, 'refused', '38-38.json'), 'utf8'));
        assert.deepStrictEqual([kept.answer, kept.batch.map(v => v.line)], [`${status} these lines will never be taken`, ['line 37']], 'the line and what Logline answered, for whoever owns the machine');
        assert.deepStrictEqual(ship.said, ['logline_batch_refused'], `${status}: said when it is put aside, not at every try`);
        assert.match(logline.lines.find(v => v.startsWith('[logline_batch_refused]')), new RegExp(`"lines":1,"reason":"${status} these lines will never be taken","kept":"refused/38-38\\.json"`));
    }));
});

test('a Logline that is away or failing is waited for, whatever it answers: nothing is put aside, and every line arrives once it is back', async function () {
    // 502 is also all a lines server from before SM-287 answers, whatever its store said; 0 is
    // a connection cut with no answer
    await Promise.all([502, 500, 503, 504, 429, 408, 404, 0].map(async function (status) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logline-ship-'));
        const logline = await logline_fake(v => (v <= 2) ? status : true);
        const spool = spool_on_disk(dir);
        for (const line of ['one', 'two', 'three']) {
            spool.add(line);
        }
        const ship = ship_start(spool, logline.endpoint, 50, dir);
        try {
            await until(() => logline.lines.length >= 4);
        }
        finally {
            ship.stop();
            logline.close();
            spool.close();
        }
        assert.deepStrictEqual(logline.lines.slice(0, 3), ['one', 'two', 'three'], `${status}: the same batch, whole, once Logline takes it`);
        assert.strictEqual(fs.existsSync(path.join(dir, 'refused')), false, `${status}: nothing is put aside`);
        assert.deepStrictEqual(ship.said, ['logline_ship_error'], `${status}: said once`);
    }));
});

test('refused/ keeps no more than its bound: at it the refused line waits in the spool with the lines behind it, and goes aside once there is room', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logline-ship-'));
    fs.mkdirSync(path.join(dir, 'refused'));
    for (let i = 0; i < 1000; i++) {
        fs.writeFileSync(path.join(dir, 'refused', `old-${i}.json`), '{}');
    }
    assert.deepStrictEqual(logline_aside(dir), {files: 1000, bytes: 2000, full: true});
    const logline = await logline_fake((asked, items) => items.some(v => v.line === 'never taken') ? 422 : true);
    const spool = spool_on_disk(dir);
    spool.add('never taken');
    spool.add('behind it');
    const ship = ship_start(spool, logline.endpoint, 50, dir);
    try {
        await until(() => ship.said.length > 0);
        await timers.setTimeout(300);
        assert.deepStrictEqual(ship.said, ['logline_ship_error'], 'said once that it waits');
        assert.strictEqual(fs.readdirSync(path.join(dir, 'refused')).length, 1000, 'no file more');
        assert.deepStrictEqual(logline.lines, [], 'and no line lost or sent out of turn: both wait in the spool');
        // Whoever owns the machine makes room
        fs.rmSync(path.join(dir, 'refused', 'old-0.json'));
        await until(() => logline.lines.includes('behind it') && logline.lines.some(v => v.startsWith('[logline_ship_error]')));
    }
    finally {
        ship.stop();
        logline.close();
        spool.close();
    }
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'refused', '1-1.json'), 'utf8')).batch.map(v => v.line), ['never taken'], 'the refused line is aside now');
    assert.strictEqual(logline.lines.includes('never taken'), false);
    assert.match(logline.lines.find(v => v.startsWith('[logline_ship_error]')), /"reason":"422 these lines will never be taken","waiting":2,"then":"kept in the spool until refused\/ has room: it is full"/, 'and what it waited for was said in words');
});

test('what is put aside is full at a thousand files or 64 MB, and a folder nobody made holds nothing', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logline-ship-'));
    assert.deepStrictEqual(logline_aside(dir), {files: 0, bytes: 0, full: false});
    fs.mkdirSync(path.join(dir, 'refused'));
    fs.writeFileSync(path.join(dir, 'refused', '1-1.json'), '{"answer":"422"}');
    // What a crash in the middle of a write leaves is not a file of lines
    fs.writeFileSync(path.join(dir, 'refused', '2-2.json.new'), '{"ans');
    assert.deepStrictEqual(logline_aside(dir), {files: 1, bytes: 16, full: false});
    // A file of 64 MB that takes no room on the disk
    fs.truncateSync(path.join(dir, 'refused', '1-1.json'), 64*1024*1024);
    assert.deepStrictEqual(logline_aside(dir), {files: 1, bytes: 64*1024*1024, full: true});
});

test('killed after a line is put aside and before the spool moved on, the agent sends it again, keeps one file of it, and sends no line behind it twice, though that file filled refused/', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logline-ship-'));
    // One file short of the bound: the file of the line is the last that fits
    fs.mkdirSync(path.join(dir, 'refused'));
    for (let i = 0; i < 999; i++) {
        fs.writeFileSync(path.join(dir, 'refused', `old-${i}.json`), '{}');
    }
    const logline = await logline_fake((asked, items) => items.some(v => v.line === 'never taken') ? 422 : true);
    let spool = spool_on_disk(dir);
    for (const line of ['never taken', 'behind it', 'and one more']) {
        spool.add(line);
    }
    // The process ends between the two writes: the file is there, the spool has not moved on
    const dying = Object.assign({}, spool, {
        ack: function () {
            throw new Error('killed here');
        },
    });
    let ship = ship_start(dying, logline.endpoint, 50, dir);
    await until(() => ship.said.includes('logline_ship_error'));
    ship.stop();
    spool.close();
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'refused')).filter(v => v.startsWith('old-') === false), ['1-1.json']);
    assert.strictEqual(logline_aside(dir).full, true, 'and refused/ is at its bound now');
    assert.deepStrictEqual(logline.lines, [], 'nothing behind it went before the spool moved on');
    // The agent starts again, with the spool as the disk has it
    spool = spool_on_disk(dir);
    ship = ship_start(spool, logline.endpoint, 50, dir);
    try {
        await until(() => logline.lines.includes('and one more'));
        await timers.setTimeout(200);
    }
    finally {
        ship.stop();
        logline.close();
        spool.close();
    }
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'refused')).filter(v => v.startsWith('old-') === false), ['1-1.json'], 'the same file, written again, and not waited on as one more');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'refused', '1-1.json'), 'utf8')).batch.map(v => v.line), ['never taken']);
    assert.deepStrictEqual(logline.lines.filter(v => v.startsWith('[') === false), ['behind it', 'and one more'], 'each line behind it once');
});

// A shipper of this spool to this Logline, gathering lines gather_ms, whose own lines go into the
// spool it ships and wake it, as in agent_logline: {stop, wake, said}. `dir` is the spool's own
// folder when it has one.
function ship_start(spool, endpoint, gather_ms, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logline-ship-')))
{
    const said = [];
    const stats = {sent_lines: 0, sent_batches: 0, sent_bytes: 0, last_sent_at: null, last_answer: null, failing: null};
    const ship = logline_ship({spool, dir, stats, gather_ms, say, settings: () => ({logs: 'all', endpoint, token: 't'})});
    function say(sender, words) {
        said.push(sender);
        spool.add(`[${sender}] ${JSON.stringify(words)}`);
        ship.wake();
    }
    return {stop: ship.stop, wake: ship.wake, said};
}

// A Logline that takes a batch when `takes(asked, items)` says so and refuses it with a 401
// otherwise, or with the status `takes` gives (0 cuts the connection with no answer), counting
// its requests and the lines it stored: {endpoint, asked, stored, lines, close}
async function logline_fake(takes)
{
    const out = {endpoint: null, asked: 0, stored: 0, lines: [], close: null};
    const server = http.createServer(function (req, res) {
        const chunks = [];
        req.on('data', v => chunks.push(v));
        req.on('end', function () {
            out.asked++;
            const items = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const count = items.length;
            const said = takes(out.asked, items);
            const ok = (said === true);
            if (said === 0) {
                req.socket.destroy();
                return;
            }
            out.stored += ok ? count : 0;
            out.lines.push(...(ok ? items.map(v => (typeof v === 'string') ? v : v.line) : []));
            if (typeof said === 'number') {
                res.writeHead(said, {'content-type': 'application/json'});
                res.end(JSON.stringify({error: [400, 413, 422].includes(said) ? 'these lines will never be taken' : 'the store is away'}));
                return;
            }
            res.writeHead(ok ? 200 : 401, {'content-type': 'application/json'});
            res.end(JSON.stringify(ok ? {stored: count} : {error: 'not from an address this token was issued for'}));
        });
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    out.endpoint = `http://127.0.0.1:${server.address().port}/lines`;
    out.close = function () {
        server.close();
    };
    return out;
}

// What logline_ship asks of a spool: how much waits, the lines not acked yet as one batch
function spool_in_memory()
{
    const lines = [];
    return {
        add: v => lines.push(v),
        batch: function (max_items) {
            if (lines.length === 0) {
                return null;
            }
            const items = lines.slice(0, max_items);
            return {body: JSON.stringify(items), count: items.length, first: 0, last: items.length - 1};
        },
        ack: function (cut) {
            lines.splice(0, cut.count);
        },
        stats: () => ({waiting_lines: lines.length, waiting_bytes: lines.join('').length}),
    };
}

// The agent's spool on the disk, in `dir`, taking a line as the spool in memory does
function spool_on_disk(dir)
{
    const spool = logline_spool(dir, {cap_bytes: 1e9, sync_ms: 60000});
    return Object.assign(spool, {
        add: function (line) {
            spool.append({src: 'web', at: '2026-09-25T18:00:01.000000000Z', time: '2026-09-25T18:00:01.000000000Z', labels: {service: 'web'}, line});
            spool.flush();
        },
    });
}

async function until(ready)
{
    const deadline = Date.now() + 10000;
    while (ready() === false) {
        if (Date.now() > deadline) {
            throw new Error('the condition never came true');
        }
        await timers.setTimeout(20);
    }
}
