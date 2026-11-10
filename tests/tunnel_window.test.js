const EventEmitter = require('events');
const assert = require('assert');
const link_read = require('../src/helpers/link_read');
const stream = require('stream');
const test = require('node:test');
const tunnel_stream = require('../src/main/src/helpers/tunnel_stream');
const tunnel_window = require('../src/helpers/tunnel_window');

const KB = 1024;
const MB = 1024*1024;

// A link socket that takes what it is given and says whether it has room for more. With
// `taking` off, what it is given waits in its queue until take()
function link_fake()
{
    const out = new EventEmitter();
    const queued = [];
    out.room = true;
    out.taking = true;
    out.bytes = 0;
    out.write = function (chunk, done) {
        this.bytes += chunk.length;
        if (done !== undefined) {
            queued.push(done);
        }
        if (this.taking) {
            this.take();
        }
        return this.room;
    };
    out.take = function () {
        for (const done of queued.splice(0)) {
            done(null);
        }
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

// A machine sent 400 MB into the 4 MB of room a file's stream gave it, and made room for a
// gigabyte of a visitor's bytes it never read (2026-11-09), and this host kept all of it: this
// end counts what the far one sends and the room it makes, and takes its word for neither
test('a stream sent more than its window and a piece unread is dropped, and so is one given room for bytes it was never sent', async function () {
    // What the far end may send unread: its window, and less than a piece over, since it began
    // its last piece with room. A piece is a frame, 1 MB; a walk's is a folder's names.
    for (const [target, piece, window, over] of [[{port: 80}, undefined, 256*KB, MB], [{read: {}}, undefined, 4*MB, MB], [{tree: {}}, 16*MB, 256*KB, 16*MB]]) {
        const link = link_kept();
        const unread = tunnel_stream(link.socket, 2, false, tunnel_window(target), undefined, piece);
        const errors = [];
        unread.on('error', e => errors.push(e));
        unread.tunnel_data(Buffer.alloc(window - 1));
        for (let sent = 0; sent < over; sent += 64*KB) {
            unread.tunnel_data(Buffer.alloc(64*KB));
        }
        assert.strictEqual(unread.destroyed, false, 'a window and all but a byte of a piece is what an honest end may have sent');
        assert.deepStrictEqual(unread.tunnel_data(Buffer.alloc(1)), {reason: 'stream_past_window', stream: 2, unread: window + over, window}, JSON.stringify(target));
        assert.strictEqual(unread.destroyed, true);
        assert.strictEqual(unread.tunnel_data(Buffer.alloc(64*KB)), null, 'said once: what comes after means nothing');
        await new Promise(v => setImmediate(v));
        assert.deepStrictEqual(errors.map(v => v.code), ['EWINDOW']);
        assert.deepStrictEqual(link.frames.map(v => [v.kind, v.id, v.said.code]), [['x', 2, 'EWINDOW']], 'the far end is told why');
        assert.match(link.frames[0].said.message, new RegExp(`^stream 2: its far end sent ${window + over} bytes unread into a window of ${window}$`));
    }

    // A reader that reads makes room, and the far end may fill it again, for as long as it likes
    const link = link_kept();
    const read = tunnel_stream(link.socket, 4);
    let got = 0;
    read.on('data', function (chunk) {
        got += chunk.length;
    });
    for (let i = 0; i < 64; i++) {
        assert.strictEqual(read.tunnel_data(Buffer.alloc(200*KB)), null);
        await new Promise(v => setImmediate(v));
    }
    assert.strictEqual(got, 64*200*KB);
    assert.strictEqual(link.frames.filter(v => v.kind === 'r').reduce((sum, v) => sum + v.room, 0), 64*200*KB, 'room was made for every byte read');
    read.destroy();

    // Room is for bytes that were sent: all of them at most
    const sending = link_kept();
    const sent = tunnel_stream(sending.socket, 6);
    const errors = [];
    sent.on('error', e => errors.push(e));
    sent.write(Buffer.alloc(64*KB));
    assert.strictEqual(sent.tunnel_credit(60*KB), null);
    assert.strictEqual(sent.tunnel_credit(4*KB), null);
    await new Promise(v => setImmediate(v));
    assert.strictEqual(sent.taken, 64*KB);
    sent.write(Buffer.alloc(KB));
    assert.deepStrictEqual(sent.tunnel_credit(KB + 1), {reason: 'stream_room_unsent', stream: 6, room: KB + 1, on_its_way: KB});
    assert.strictEqual(sent.destroyed, true);
    assert.strictEqual(sent.taken, 64*KB, 'room that was refused is not room');
    await new Promise(v => setImmediate(v));
    assert.deepStrictEqual(errors.map(v => [v.code, v.message]), [['EWINDOW', `stream 6: its far end made room for ${KB + 1} bytes, and ${KB} were on their way`]]);
    assert.deepStrictEqual(sending.frames.filter(v => v.kind === 'x').map(v => [v.id, v.said.code]), [[6, 'EWINDOW']]);
});

// The same machine made room in steps, never for more than it had been sent, and read nothing:
// the 300 MB stood in the queue of this host's own link all the same. Bytes the link has not
// taken were read by nobody.
test('room made for bytes still in this host\'s queue is room once the link has taken them', async function () {
    const socket = link_fake();
    const plain = tunnel_stream(socket, 2);
    socket.taking = false;
    await written_until_held(plain, MB);
    assert.strictEqual(plain.sent, 256*KB);
    // Room for all of it, as the far end says, and none of it has left this host
    plain.tunnel_credit(256*KB);
    assert.strictEqual(plain.taken, 0);
    await written_until_held(plain, MB);
    assert.strictEqual(plain.sent, 256*KB, 'nothing more is sent on its word');
    // The link takes them: what was said of them counts now, and the stream goes on
    const taken = [];
    plain.on('taken', v => taken.push(v));
    socket.take();
    assert.deepStrictEqual([plain.taken, taken.reduce((sum, v) => sum + v, 0)], [256*KB, 256*KB]);
    socket.taking = true;
    await written_until_held(plain, MB);
    assert.deepStrictEqual([plain.sent, plain.taken], [512*KB, 256*KB]);
    plain.destroy();
});

// A link socket whose frames are kept as the far end would read them: {kind, id}, with `said`
// for the end of a stream and `room` for room made
function link_kept()
{
    const out = {socket: new stream.PassThrough(), frames: []};
    link_read(out.socket, function (kind, body) {
        const frame = {kind, id: body.readUInt32BE(0)};
        if (kind === 'x') {
            frame.said = JSON.parse(body.subarray(4).toString('utf8'));
        }
        if (kind === 'r') {
            frame.room = body.readUInt32BE(4);
        }
        out.frames.push(frame);
    });
    return out;
}

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
