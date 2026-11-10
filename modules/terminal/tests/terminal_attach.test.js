const EventEmitter = require('events');
const assert = require('assert');
const stream = require('stream');
const terminal_attach = require('../server/terminal_attach');
const terminal_guard = require('../server/terminal_guard');
const terminal_refuse = require('../server/terminal_refuse');
const test = require('node:test');
const timers = require('timers/promises');

const KB = 1024;
const MB = 1024*1024;
// What a far end prints at once
const PIECE_BYTES = 16*KB;

test('a pane\'s own error is heard and costs that pane alone', function () {
    const client = new EventEmitter();
    let cut = 0;
    client.terminate = function () {
        cut++;
    };
    terminal_guard(client);
    // An EventEmitter with nobody listening throws its error: here that would end the host
    assert.doesNotThrow(() => client.emit('error', new RangeError('Invalid WebSocket frame: RSV2 and RSV3 must be clear')));
    assert.strictEqual(cut, 1);
});

test('the pane and the far end are joined both ways, and either end going away ends the other', function () {
    const client = client_fake();
    const stream = stream_fake();
    const sizes = [];
    let ended = 0;
    terminal_attach(client, stream, {note: 'a shell on box', resize: v => sizes.push(v), end: () => ended++});

    // The note first, saying it is a terminal; then what the far end prints, as bytes
    assert.deepStrictEqual(JSON.parse(client.sent[0]), {type: 'note', text: 'a shell on box', ok: true});
    stream.emit('data', Buffer.from('$ '));
    assert.deepStrictEqual(client.sent[1], Buffer.from('$ '));

    // What is typed goes to the far end; a size goes to the host; anything else is dropped
    client.emit('message', JSON.stringify({type: 'input', data: 'ls\r'}));
    client.emit('message', JSON.stringify({type: 'resize', cols: 120, rows: 40}));
    client.emit('message', 'not json');
    client.emit('message', JSON.stringify({type: 'other'}));
    assert.deepStrictEqual(stream.written, ['ls\r']);
    assert.deepStrictEqual(sizes, [{cols: 120, rows: 40}]);

    // The pane goes away: the stream is closed and the host hears of it once
    client.emit('close');
    assert.strictEqual(stream.destroyed, true);
    assert.strictEqual(ended, 1);

    // The far end goes away, or fails: the pane is closed
    const other = client_fake();
    const gone = stream_fake();
    terminal_attach(other, gone, {note: 'x', resize: function () {}, end: function () {}});
    gone.emit('close');
    assert.strictEqual(other.closed, true);
    const failed = client_fake();
    const broken = stream_fake();
    terminal_attach(failed, broken, {note: 'x', resize: function () {}, end: function () {}});
    broken.emit('error', new Error('cut'));
    assert.strictEqual(failed.closed, true);
});

test('a frame that is not what a pane sends is dropped, and a handler that fails closes this pane alone', function () {
    const client = client_fake();
    const stream = stream_fake();
    const sizes = [];
    terminal_attach(client, stream, {note: 'x', resize: v => sizes.push(v), end: function () {}});
    // Input that is no text: a number, null, an object, none at all
    for (const data of [123, null, {a: 1}, ['x'], undefined]) {
        client.emit('message', JSON.stringify({type: 'input', data}));
    }
    client.emit('message', JSON.stringify(null));
    client.emit('message', JSON.stringify('input'));
    // A size no terminal has: text, an object, zero, a fraction, a window no size holds
    for (const [cols, rows] of [['x&y=1', {}], ['80', '24'], [0, 24], [80, -1], [80.5, 24], [70000, 24], [80, 1e9], [null, null]]) {
        client.emit('message', JSON.stringify({type: 'resize', cols, rows}));
    }
    assert.deepStrictEqual(stream.written, []);
    assert.deepStrictEqual(sizes, []);
    assert.strictEqual(client.closed, false, 'dropped, and the pane stays');
    client.emit('message', JSON.stringify({type: 'input', data: 'ls\r'}));
    client.emit('message', JSON.stringify({type: 'resize', cols: 1, rows: 4096}));
    assert.deepStrictEqual(stream.written, ['ls\r']);
    assert.deepStrictEqual(sizes, [{cols: 1, rows: 4096}]);

    // The far end refuses a write: this pane closes, nothing is thrown at the host
    const broken = stream_fake();
    broken.write = function () {
        throw new Error('write after end');
    };
    const other = client_fake();
    terminal_attach(other, broken, {note: 'x', resize: function () {}, end: function () {}});
    other.emit('message', JSON.stringify({type: 'input', data: 'ls\r'}));
    assert.strictEqual(other.closed, true);
    assert.strictEqual(client.closed, false);
});

// `cat` of a big file, or `yes`, watched over a slow line: what the pane has not read waited in
// this process, all of it, and the far end was never told to wait
test('a far end that prints faster than its pane reads is held back, and the pane gets every byte in order', async function () {
    const pane = pane_slow();
    const far = far_end(8*MB);
    terminal_attach(pane, far, {note: 'x', resize: function () {}, end: function () {}});

    // The pane reads nothing: the far end prints until the mark, then waits where it is
    await settled();
    const most = terminal_attach.MARK_BYTES + PIECE_BYTES;
    assert.ok(pane.bufferedAmount <= most, `held for the pane: ${pane.bufferedAmount} of ${far.printed} printed`);
    assert.ok(far.printed < 1*MB, `the far end printed ${far.printed} of ${8*MB} and waits`);
    assert.strictEqual(far.isPaused(), true);

    // What is typed goes the other way and is never held: Ctrl-C reaches the far end at once
    pane.emit('message', JSON.stringify({type: 'input', data: '\x03'}));
    assert.deepStrictEqual(far.typed, ['\x03']);

    // The pane reads on, slowly: never more than the mark waits for it, and the far end ends
    // with the pane a mark behind. The pane is closed after the last byte, not before
    let held_most = 0;
    for (let i = 0; (i < 8*MB/(64*KB) + 8) && (pane.closed === false); i++) {
        pane.take(64*KB);
        await settled();
        held_most = Math.max(held_most, pane.bufferedAmount);
    }
    assert.ok(held_most <= most, `held for the pane while it read: ${held_most}`);
    assert.strictEqual(far.printed, 8*MB);
    assert.strictEqual(pane.closed, true, 'the far end ended, and the pane with it');
    assert.strictEqual(Buffer.compare(Buffer.concat(pane.got), far_bytes(0, 8*MB)), 0, 'every byte, in order');
});

test('a pane that reads as fast as the far end prints never holds it back', async function () {
    const pane = pane_slow();
    const far = far_end(4*MB);
    let pauses = 0;
    far.on('pause', () => pauses++);
    // A line that takes each piece the moment it is sent
    pane.fast = true;
    terminal_attach(pane, far, {note: 'x', resize: function () {}, end: function () {}});
    await settled();
    assert.strictEqual(pane.closed, true);
    assert.strictEqual(pauses, 0);
    assert.strictEqual(Buffer.compare(Buffer.concat(pane.got), far_bytes(0, 4*MB)), 0);
});

test('a pane that goes away while its far end is held back takes the stream with it', async function () {
    const pane = pane_slow();
    const far = far_end(8*MB);
    let ended = 0;
    terminal_attach(pane, far, {note: 'x', resize: function () {}, end: () => ended++});
    await settled();
    assert.strictEqual(far.isPaused(), true);
    const printed = far.printed;
    pane.emit('close');
    await settled();
    assert.strictEqual(far.destroyed, true);
    assert.strictEqual(far.printed, printed, 'nothing more is printed for a pane that is gone');
    assert.strictEqual(ended, 1);
});

test('a refusal is a note that says why, without ok, and the socket closes', function () {
    const client = client_fake();
    terminal_refuse(client, 'box is not connected');
    assert.deepStrictEqual(JSON.parse(client.sent[0]), {type: 'note', text: 'box is not connected'});
    assert.strictEqual(client.closed, true);
});

function client_fake()
{
    const out = new EventEmitter();
    out.sent = [];
    out.closed = false;
    out.send = function (value) {
        out.sent.push(value);
    };
    out.close = function () {
        out.closed = true;
    };
    return out;
}

// A pane gone dark without closing, a laptop asleep with its tab open, would hold its far end
// for as long as its socket stands: the program there waits to print, and on a kept terminal
// everyone else joined to it waits behind it. A held pane that takes nothing for a while is
// let go; one that is only slow takes a piece now and then, and is never let go.
test('a held pane that takes nothing at all is let go after a while, and one that takes a little is not', async function () {
    const dark = pane_slow();
    const far = far_end(8*MB);
    let ended = 0;
    terminal_attach(dark, far, {note: 'x', resize: function () {}, end: () => ended++, stuck_ms: 200});
    await settled();
    assert.deepStrictEqual([far.isPaused(), dark.terminated], [true, false]);
    await timers.setTimeout(500);
    assert.strictEqual(dark.terminated, true, 'it took nothing for the whole wait');
    assert.deepStrictEqual([far.destroyed, ended], [true, 1]);

    const slow = pane_slow();
    const other = far_end(8*MB);
    terminal_attach(slow, other, {note: 'x', resize: function () {}, end: function () {}, stuck_ms: 200});
    await settled();
    assert.strictEqual(other.isPaused(), true);
    for (let i = 0; i < 10; i++) {
        await timers.setTimeout(40);
        slow.take(PIECE_BYTES);
    }
    assert.deepStrictEqual([slow.terminated, other.destroyed], [false, false], 'it took a piece within every wait');
    slow.emit('close');
});

// A pane's socket on a slow line: what it is sent waits in it, counted as a websocket counts
// it, until take(bytes) says the line took that much. A piece is sent once the line took all
// of it, as a socket says so, and a close goes behind what waits, as a websocket's does.
function pane_slow()
{
    const out = new EventEmitter();
    const waiting = [];
    let closing = false;
    out.got = [];
    out.fast = false;
    out.closed = false;
    out.bufferedAmount = 0;
    out.send = function (value, done) {
        // The note is text, and goes at once
        if (typeof value === 'string') {
            return;
        }
        // A fast line took it already, and says so a moment later
        if (out.fast) {
            out.got.push(value);
            if (done !== undefined) {
                process.nextTick(done);
            }
            return;
        }
        waiting.push({value, left: value.length, done});
        out.bufferedAmount += value.length;
    };
    out.take = function (bytes) {
        let room = bytes;
        while ((waiting.length > 0) && (room > 0)) {
            const taken = Math.min(room, waiting[0].left);
            waiting[0].left -= taken;
            room -= taken;
            out.bufferedAmount -= taken;
            if (waiting[0].left === 0) {
                const sent = waiting.shift();
                out.got.push(sent.value);
                if (sent.done !== undefined) {
                    sent.done();
                }
            }
        }
        out.closed = closing && (waiting.length === 0);
    };
    out.close = function () {
        closing = true;
        out.closed = (waiting.length === 0);
    };
    // Cut, as a socket is that takes nothing: what waits in it is gone with it
    out.terminated = false;
    out.terminate = function () {
        out.terminated = true;
        out.emit('close');
    };
    return out;
}

// A far end that prints `total` bytes as fast as they are read and waits when they are not, as
// a program on a pty does; then it ends. What is typed to it is kept.
function far_end(total)
{
    const out = new stream.Duplex({
        allowHalfOpen: false,
        read: function () {
            while (out.printed < total) {
                const piece = far_bytes(out.printed, Math.min(PIECE_BYTES, total - out.printed));
                out.printed += piece.length;
                if (out.push(piece) === false) {
                    return;
                }
            }
            out.push(null);
        },
        write: function (chunk, encoding, done) {
            out.typed.push(chunk.toString('utf8'));
            done();
        },
    });
    out.printed = 0;
    out.typed = [];
    return out;
}

// The bytes a far end prints from `at` on: each four say where they are, so a byte lost, or
// one out of its place, shows
function far_bytes(at, length)
{
    const out = Buffer.alloc(length);
    for (let i = 0; i < length; i += 4) {
        out.writeUInt32BE(at + i, i);
    }
    return out;
}

// Everything that could happen by itself has happened
async function settled()
{
    for (let i = 0; i < 20; i++) {
        await new Promise(v => setImmediate(v));
    }
}

function stream_fake()
{
    const out = new EventEmitter();
    out.written = [];
    out.destroyed = false;
    out.write = function (value) {
        out.written.push(value);
    };
    out.destroy = function () {
        out.destroyed = true;
    };
    return out;
}
