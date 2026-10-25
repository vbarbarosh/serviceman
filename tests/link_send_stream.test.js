const assert = require('assert');
const link_read = require('../src/helpers/link_read');
const link_send_stream = require('../src/helpers/link_send_stream');
const stream = require('stream');
const test = require('node:test');

// A stream's data goes down the link in frames the far end's reader takes, however big the
// chunk a sender hands over at once: a whole tar in one Buffer, say
test('a data frame longer than the link carries is sent as several, in order, and read back whole', async function () {
    const frames = [];
    const socket = new stream.PassThrough();
    link_read(socket, (kind, body) => frames.push({kind, body}));
    const big = Buffer.alloc(57*1024*1024 + 123);
    for (let i = 0; i < big.length; i += 4096) {
        big.writeUInt32BE(i, i);
    }
    const flushed = link_send_stream(socket, 'd', 8, big);
    assert.strictEqual(typeof flushed, 'boolean');
    link_send_stream(socket, 'e', 8);
    socket.end();
    await new Promise(function (resolve) {
        socket.on('end', resolve);
    });
    await new Promise(function (resolve) {
        setImmediate(resolve);
    });

    const data = frames.filter(v => v.kind === 'd');
    assert.ok(data.length > 1, `in pieces: ${data.length}`);
    for (const frame of data) {
        assert.strictEqual(frame.body.readUInt32BE(0), 8, 'each piece names the stream');
        assert.ok(frame.body.length - 4 <= link_send_stream.CHUNK_BYTES);
    }
    assert.ok(Buffer.concat(data.map(v => v.body.subarray(4))).equals(big), 'the bytes, whole and in order');
    assert.deepStrictEqual(frames[frames.length - 1].kind, 'e');
});

test('a small frame, and one of another kind, go as one', function () {
    const frames = [];
    const socket = new stream.PassThrough();
    link_read(socket, (kind, body) => frames.push({kind, body}));
    link_send_stream(socket, 'd', 2, Buffer.from('hello'));
    link_send_stream(socket, 'o', 4, Buffer.from(JSON.stringify({tar_put: {dir: '/x'}})));
    link_send_stream(socket, 'r', 2);
    return new Promise(function (resolve) {
        setImmediate(function () {
            assert.deepStrictEqual(frames.map(v => [v.kind, v.body.readUInt32BE(0), v.body.subarray(4).toString()]), [['d', 2, 'hello'], ['o', 4, '{"tar_put":{"dir":"/x"}}'], ['r', 2, '']]);
            resolve();
        });
    });
});
