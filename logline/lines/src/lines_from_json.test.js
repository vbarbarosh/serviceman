const assert = require('assert');
const lines_from_json = require('./lines_from_json');
const test = require('node:test');
const time_utc = require('./time_utc');

test('a time in any zone is the same instant in UTC, to the nanosecond; a time that is not real is none', function () {
    assert.strictEqual(time_utc('2026-09-25T18:17:09.979123456Z'), '2026-09-25T18:17:09.979123456Z');
    assert.strictEqual(time_utc('2026-09-25T22:17:09.979+03:00'), '2026-09-25T19:17:09.979000000Z');
    assert.strictEqual(time_utc('2026-01-01T00:30:00-01:00'), '2026-01-01T01:30:00.000000000Z');
    assert.strictEqual(time_utc('2026-09-25T18:17:09Z'), '2026-09-25T18:17:09.000000000Z');
    assert.strictEqual(time_utc('2026-02-30T00:00:00Z'), null, 'a day February does not have');
    assert.strictEqual(time_utc('2026-09-25T24:00:00Z'), null);
    assert.strictEqual(time_utc('2026/09/25 22:41:30'), null, 'the agent turns that into ISO before sending');
    assert.strictEqual(time_utc('2026-09-25T18:17:09.979'), null, 'a time without a zone is not an instant');
    assert.strictEqual(time_utc(1790360029979), null);
});

test('a batch is taken whole, or refused with the item that is wrong', function () {
    const items = lines_from_json([
        {time: '2026-09-25T18:17:09.979Z', labels: {host: 'server.example.com', service: 'ffmpeg'}, line: '[c7t0xb1m][mp4gif_worker_begin]'},
    ]);
    assert.deepStrictEqual(items, [{time: '2026-09-25T18:17:09.979000000Z', labels: {host: 'server.example.com', service: 'ffmpeg'}, line: '[c7t0xb1m][mp4gif_worker_begin]'}]);
    // The list labels were at first, as a batch cut before the change still carries them
    const old = lines_from_json([{time: '2026-09-25T18:17:09.979Z', labels: [{name: 'host', value: 'server.example.com'}], line: 'x'}]);
    assert.deepStrictEqual(old[0].labels, {host: 'server.example.com'});
    assert.deepStrictEqual(lines_from_json([]), []);
    assert.throws(() => lines_from_json({}), /expected an array/);
    assert.throws(() => lines_from_json([{time: 'yesterday', labels: {}, line: ''}]), /^Error: \[0\]\.time: expected an ISO time/);
    assert.throws(() => lines_from_json([{time: '2026-09-25T18:17:09Z', labels: 'host=x', line: ''}]), /\[0\]\.labels: expected an object of names and values/);
    assert.throws(() => lines_from_json([{time: '2026-09-25T18:17:09Z', labels: {host: 7}, line: ''}]), /\[0\]\.labels\.host: a label is a name and a value/);
    assert.throws(() => lines_from_json([{time: '2026-09-25T18:17:09Z', labels: {}, line: 42}]), /\[0\]\.line: expected a string/);
});
