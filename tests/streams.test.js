const assert = require('assert');
const stream_open = require('../src/main/src/helpers/stream_open');
const stream_read = require('../src/main/src/helpers/stream_read');
const streams_of = require('../src/main/src/helpers/streams_of');
const test = require('node:test');

// An answer that keeps what is written to it, and says when it ends
function answer_kept()
{
    const out = {status: null, said: '', ended: false, closers: []};
    out.writeHead = function (status) {
        out.status = status;
    };
    out.write = function (text) {
        out.said += text;
    };
    out.end = function () {
        out.ended = true;
    };
    out.on = function (event, fn) {
        out.closers.push(fn);
    };
    return out;
}

function lines_of(answer)
{
    return answer.said.trim().split('\n').map(v => JSON.parse(v));
}

test('a stream is read from its first line, then as it goes, to its end; one read after the end gets it all', function () {
    const app = {};
    const stream = stream_open(app, {title: 'pull web', base: '/api/v1/remotes/vps1/docker'});
    assert.match(stream.id, /^s_[0-9a-f]{24}$/);
    assert.strictEqual(stream.url, `/api/v1/streams/${stream.id}`);
    assert.strictEqual(streams_of(app).get(stream.id), stream);
    stream.write({text: 'one'});

    const early = answer_kept();
    stream_read(stream, early);
    assert.deepStrictEqual([early.status, lines_of(early), early.ended], [200, [{text: 'one'}], false]);
    stream.write({progress: {done: 1, total: 2}});
    stream.end({end: 'done', said: 'pulled'});
    stream.write({text: 'after the end is never said'});
    stream.end({end: 'failed', said: 'nor a second end'});
    assert.deepStrictEqual(lines_of(early), [{text: 'one'}, {progress: {done: 1, total: 2}}, {end: 'done', said: 'pulled'}]);
    assert.strictEqual(early.ended, true);
    assert.deepStrictEqual([stream.state, typeof stream.ended_at], ['done', 'number']);

    const late = answer_kept();
    stream_read(stream, late);
    assert.strictEqual(late.said, early.said);
    assert.strictEqual(late.ended, true);
});

test('a reader that goes away is not written to again', function () {
    const stream = stream_open({}, {title: 'prune', base: '/x'});
    const gone = answer_kept();
    stream_read(stream, gone);
    for (const closer of gone.closers) {
        closer();
    }
    stream.write({text: 'later'});
    assert.strictEqual(gone.said, '');
    assert.strictEqual(stream.readers.size, 0);
});

test('a long stream keeps its last lines, and a reader is told how many went', function () {
    const stream = stream_open({}, {title: 'upgrade', base: '/x'});
    for (let i = 0; i < 5003; i++) {
        stream.write({text: String(i)});
    }
    const answer = answer_kept();
    stream_read(stream, answer);
    const lines = lines_of(answer);
    assert.deepStrictEqual(lines[0], {text: '… the first 3 lines are not kept'});
    assert.deepStrictEqual([lines[1], lines[lines.length - 1], lines.length], [{text: '3'}, {text: '5002'}, 5001]);
});

test('a stream both ways hands its join over once, and is gone then', function () {
    const app = {};
    const stream = stream_open(app, {title: 'the terminal work', base: '/x', join: {remote: 'vps1', term: 'work'}, token: 'abc'});
    assert.deepStrictEqual([stream.kind, stream.token], ['both', 'abc']);
    assert.deepStrictEqual(stream.take(), {remote: 'vps1', term: 'work'});
    assert.strictEqual(streams_of(app).has(stream.id), false);
});

test('an ended stream is forgotten ten minutes on, and one both ways a minute on if nobody joins it', function (t) {
    t.mock.timers.enable({apis: ['setTimeout']});
    const app = {};
    const lines = stream_open(app, {title: 'pull', base: '/x'});
    const both = stream_open(app, {title: 'join', base: '/x', join: {remote: 'vps1', term: '1'}});
    lines.end({end: 'done', said: 'ok'});
    t.mock.timers.tick(60*1000);
    assert.deepStrictEqual([streams_of(app).has(lines.id), streams_of(app).has(both.id)], [true, false]);
    t.mock.timers.tick(9*60*1000);
    assert.strictEqual(streams_of(app).has(lines.id), false);
});
