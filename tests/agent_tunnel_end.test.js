const agent_tunnel = require('../src/agent/src/agent_tunnel');
const assert = require('assert');
const net = require('net');
const stream = require('stream');
const test = require('node:test');

// A far end that is done says so twice: `e` once it sent all, `x` once its socket closed. What
// this end was sent before them reaches its reader whole, however slowly it reads
test('a stream whose far end closed hands its reader every byte it was sent', async function (t) {
    const got = [];
    let reader = null;
    const server = net.createServer(function (socket) {
        reader = socket;
        // A reader that takes its time: nothing is read until the far end has said both words
        socket.pause();
        socket.on('data', v => got.push(v));
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(() => server.close());
    const link = new stream.PassThrough();
    link.resume();
    const state = {link, streams: {}, next_stream_id: 0};

    const sent = Buffer.alloc(4*1024*1024, 'x');
    agent_tunnel(state, 'o', body_of(2, Buffer.from(JSON.stringify({host: '127.0.0.1', port: server.address().port}))));
    await until(() => (reader !== null) && state.streams[2].socket.writable);
    for (let at = 0; at < sent.length; at += 64*1024) {
        agent_tunnel(state, 'd', body_of(2, sent.subarray(at, at + 64*1024)));
    }
    agent_tunnel(state, 'e', body_of(2));
    agent_tunnel(state, 'x', body_of(2, Buffer.from('{}')));
    const closed = new Promise(v => reader.on('end', v));
    reader.resume();
    await closed;
    assert.strictEqual(Buffer.concat(got).length, sent.length, 'every byte, then the end');
    assert.strictEqual(state.streams[2], undefined, 'and the stream is forgotten');
});

// A far end that broke, or went before it said it had sent all (a copy cancelled): this end goes
// at once, so a file half written never takes its name
test('a stream whose far end broke, or went before its end, goes at once', async function (t) {
    const server = net.createServer(v => v.pause());
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(() => server.close());
    const link = new stream.PassThrough();
    link.resume();
    const state = {link, streams: {}, next_stream_id: 0};
    agent_tunnel(state, 'o', body_of(4, Buffer.from(JSON.stringify({host: '127.0.0.1', port: server.address().port}))));
    const socket = state.streams[4].socket;
    agent_tunnel(state, 'x', body_of(4, Buffer.from('{"code": "ECONNRESET", "message": "reset"}')));
    assert.strictEqual(socket.destroyed, true);
    assert.strictEqual(state.streams[4], undefined);

    agent_tunnel(state, 'o', body_of(6, Buffer.from(JSON.stringify({host: '127.0.0.1', port: server.address().port}))));
    const cut = state.streams[6].socket;
    agent_tunnel(state, 'd', body_of(6, Buffer.from('half')));
    agent_tunnel(state, 'x', body_of(6, Buffer.from('{}')));
    assert.strictEqual(cut.destroyed, true, 'gone with no word of its end: cut off, not done');
});

function body_of(id, rest)
{
    const head = Buffer.allocUnsafe(4);
    head.writeUInt32BE(id, 0);
    return (rest === undefined) ? head : Buffer.concat([head, rest]);
}

async function until(check)
{
    for (let i = 0; i < 200; i++) {
        if (check()) {
            return;
        }
        await new Promise(v => setTimeout(v, 10));
    }
    throw new Error('waited too long');
}
