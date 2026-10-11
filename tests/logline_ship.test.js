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
    let asked = 0;
    const server = http.createServer(function (req, res) {
        req.resume();
        req.on('end', function () {
            asked++;
            const ok = (asked % 2 === 0);
            res.writeHead(ok ? 200 : 401, {'content-type': 'application/json'});
            res.end(JSON.stringify(ok ? {stored: 1} : {error: 'not from an address this token was issued for'}));
        });
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    const endpoint = `http://127.0.0.1:${server.address().port}/lines`;

    // The agent's own lines go into the spool it ships, and each one wakes it, as in agent_logline
    const spool = spool_in_memory();
    const said = [];
    let ship = null;
    function say(sender, words) {
        said.push(sender);
        spool.add(`[${sender}] ${JSON.stringify(words)}`);
        ship.wake();
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logline-ship-'));
    const stats = {sent_lines: 0, sent_batches: 0, sent_bytes: 0, last_sent_at: null, last_answer: null, failing: null};
    ship = logline_ship({spool, dir, stats, say, settings: () => ({logs: 'all', endpoint, token: 't'})});
    try {
        spool.add('a line of a container');
        await timers.setTimeout(3000);
    }
    finally {
        ship.stop();
        server.close();
    }
    assert.deepStrictEqual(said, ['logline_ship_error'], 'one error, and no ok while every other batch is refused');
    // 1s after a failure, then the next batch: a handful in three seconds, not a request per line
    assert.ok(asked <= 6, `${asked} requests in 3s`);
});

// What logline_ship asks of a spool: the lines not acked yet, as one batch
function spool_in_memory()
{
    const lines = [];
    return {
        add: v => lines.push(v),
        batch: function () {
            if (lines.length === 0) {
                return null;
            }
            return {body: JSON.stringify(lines), count: lines.length, first: 0, last: lines.length - 1};
        },
        ack: function (cut) {
            lines.splice(0, cut.count);
        },
        stats: () => ({waiting_lines: lines.length}),
    };
}
