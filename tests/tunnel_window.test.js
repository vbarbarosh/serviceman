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
    assert.strictEqual(await written_until_held(wide, 3*MB), 3*MB, 'a wide stream takes megabytes before any credit');
    // The link is full: the write that found it so is done once it drains, however much
    // window is left
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
