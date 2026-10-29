const assert = require('assert');
const fs = require('fs');
const http = require('http');
const logline_ship = require('../src/agent/src/logline_ship');
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

// A shipper of this spool to this Logline, gathering lines gather_ms, whose own lines go into the
// spool it ships and wake it, as in agent_logline: {stop, wake, said}
function ship_start(spool, endpoint, gather_ms)
{
    const said = [];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logline-ship-'));
    const stats = {sent_lines: 0, sent_batches: 0, sent_bytes: 0, last_sent_at: null, last_answer: null, failing: null};
    const ship = logline_ship({spool, dir, stats, gather_ms, say, settings: () => ({logs: 'all', endpoint, token: 't'})});
    function say(sender, words) {
        said.push(sender);
        spool.add(`[${sender}] ${JSON.stringify(words)}`);
        ship.wake();
    }
    return {stop: ship.stop, wake: ship.wake, said};
}

// A Logline that takes a batch when `takes(asked)` says so and refuses it with a 401 otherwise,
// counting its requests and the lines it stored: {endpoint, asked, stored, close}
async function logline_fake(takes)
{
    const out = {endpoint: null, asked: 0, stored: 0, close: null};
    const server = http.createServer(function (req, res) {
        const chunks = [];
        req.on('data', v => chunks.push(v));
        req.on('end', function () {
            out.asked++;
            const count = JSON.parse(Buffer.concat(chunks).toString('utf8')).length;
            const ok = takes(out.asked);
            out.stored += ok ? count : 0;
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
