const EventEmitter = require('events');
const assert = require('assert');
const terminal_attach = require('../server/terminal_attach');
const terminal_refuse = require('../server/terminal_refuse');
const test = require('node:test');

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
