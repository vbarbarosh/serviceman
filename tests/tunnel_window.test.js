const EventEmitter = require('events');
const assert = require('assert');
const test = require('node:test');
const tunnel_stream = require('../src/main/src/helpers/tunnel_stream');
const tunnel_window = require('../src/helpers/tunnel_window');

const KB = 1024;
const MB = 1024*1024;

// A link socket that takes what it is given and says whether it has room for more
function link_fake()
{
    const out = new EventEmitter();
    out.room = true;
    out.bytes = 0;
    out.write = function (chunk) {
        this.bytes += chunk.length;
        return this.room;
    };
    return out;
}

// Writes chunks of 64 KB until the stream holds one back, or all of them went; answers how
// many bytes it took
async function written_until_held(stream, total)
{
    const chunk = Buffer.alloc(64*KB);
    let taken = 0;
    while (taken < total) {
        const went = await Promise.race([
            new Promise(v => stream.write(chunk, () => v(true))),
            new Promise(v => setTimeout(() => v(false), 50)),
        ]);
        if (went === false) {
            return taken;
        }
        taken += chunk.length;
    }
    return taken;
}

test('a stream of a file\'s bytes has a window of 4 MB, every other stream one of 256 KB', function () {
    for (const target of [{file: {}}, {part: {}}, {tar_put: {}}, {read: {}}, {tar: {}}]) {
        assert.strictEqual(tunnel_window(target), 4*MB, JSON.stringify(target));
    }
    for (const target of [{port: 80}, {host: '127.0.0.1', port: 80}, {path: '/run/x.sock'}, {shell: {}}, {tree: {}}, {watch: {}}, null, undefined]) {
        assert.strictEqual(tunnel_window(target), 256*KB, JSON.stringify(target));
    }
});

test('a stream sends its window unread and no more; a wide one also waits for the link to take its bytes', async function () {
    const link = link_fake();
    const plain = tunnel_stream(link, 2);
    await written_until_held(plain, 8*MB);
    assert.ok((link.bytes >= 256*KB) && (link.bytes < 320*KB), `a plain stream stops at its window: ${link.bytes}`);
    plain.destroy();

    const socket = link_fake();
    const wide = tunnel_stream(socket, 4, false, tunnel_window({part: {}}));
    await written_until_held(wide, 3*MB);
    assert.strictEqual(wide.sent - wide.taken, 256*KB, 'a wide stream starts at the default window');
    wide.tunnel_credit(192*KB);
    await written_until_held(wide, 3*MB);
    assert.strictEqual(wide.sent - wide.taken, 256*KB, 'and stays there until a pace is seen');
    // A link measured at 2 MB/s: a second of it from the start; at 20 MB/s, 4 MB
    for (const [pace, start] of [[2*MB, 2*MB], [20*MB, 4*MB], [64*KB, 256*KB]]) {
        const measured = tunnel_stream(link_fake(), 8, false, tunnel_window({file: {}}), pace);
        await written_until_held(measured, 8*MB);
        assert.ok((measured.sent - measured.taken >= start) && (measured.sent - measured.taken < start + 64*KB), `measured at ${pace}: ${measured.sent - measured.taken}`);
        measured.destroy();
    }
    // The link is full: the write that found it so is done once it drains, however much
    // window is left
    wide.tunnel_credit(256*KB);
    socket.room = false;
    const sent = socket.bytes;
    const held = new Promise(v => wide.write(Buffer.alloc(64*KB), () => v('done')));
    assert.strictEqual(await Promise.race([held, new Promise(v => setTimeout(() => v('held'), 50))]), 'held');
    assert.ok(socket.bytes > sent, 'its bytes went to the link all the same');
    socket.room = true;
    socket.emit('drain');
    assert.strictEqual(await held, 'done');
    wide.destroy();

    // A plain stream never waits for the link: a forward or a shell is held by its window only
    const socket_plain = link_fake();
    socket_plain.room = false;
    const shell = tunnel_stream(socket_plain, 6);
    assert.strictEqual(await written_until_held(shell, 128*KB), 128*KB);
    shell.destroy();
});

// A file to a machine 2026-11-04: its 4 MB on their way held every call behind them for minutes
// once the way to the machine slowed. Its window is about a second of the pace the far end takes
// its bytes at: megabytes on a fast link, the default window on a slow one, 4 MB at most.
test('a wide stream keeps about a second of its pace on its way, 4 MB at most', async function () {
    const socket = link_fake();
    const wide = tunnel_stream(socket, 4, false, tunnel_window({part: {}}));
    const stop = pump(wide);
    try {
        await paced(wide, 64*KB, 1000);
        const at_3mb = wide.sent - wide.taken;
        assert.ok((at_3mb > 2.4*MB) && (at_3mb < 4*MB), `taken at 3.2 MB/s: ${at_3mb} on its way`);
        await paced(wide, 320*KB, 1000);
        const at_16mb = wide.sent - wide.taken;
        assert.ok((at_16mb > 3.8*MB) && (at_16mb <= 4*MB + 64*KB), `taken at 16 MB/s: ${at_16mb} on its way, 4 MB at most`);
        // The pace falls: once the last two seconds say so, nothing more goes until what is on
        // its way is about a second of it
        await paced(wide, 4*KB, 2500);
        const sent = wide.sent;
        await paced(wide, 4*KB, 2000);
        assert.strictEqual(wide.sent, sent, 'held while 4 MB is many seconds of a pace of 200 KB/s');
    }
    finally {
        stop();
        wide.destroy();
    }
});

// Writes 64 KB pieces as fast as the stream takes them, until stopped
function pump(stream)
{
    let on = true;
    (function more() {
        if (on && (stream.destroyed === false)) {
            stream.write(Buffer.alloc(64*KB), more);
        }
    })();
    return function () {
        on = false;
    };
}

// The far end takes `bytes` every 20 ms for `ms`, of what is on its way
async function paced(stream, bytes, ms)
{
    const until = Date.now() + ms;
    while (Date.now() < until) {
        await new Promise(v => setTimeout(v, 20));
        const ready = Math.min(bytes, stream.sent - stream.taken);
        if (ready > 0) {
            stream.tunnel_credit(ready);
        }
    }
    // The writer fills what was freed before anyone looks
    await new Promise(v => setTimeout(v, 5));
}
