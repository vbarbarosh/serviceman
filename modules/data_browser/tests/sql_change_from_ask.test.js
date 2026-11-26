const assert = require('assert');
const changed_said_of = require('../server/changed_said_of');
const sql_change_from_ask = require('../server/sql_change_from_ask');
const test = require('node:test');

// A change of a SQL row as asked: the key as the page read it, the columns to set (those changed
// when the row as read is given), what they held then; what is wrong refused (400)
test('a change asked is read: the key, the columns changed, what they held', function () {
    assert.deepStrictEqual(sql_change_from_ask({collection: 'orders', document: '{"customer": "ann", "total": 2.50}'}), {collection: 'orders', id: null, set: {customer: 'ann', total: {$numberDecimal: '2.50'}}, was: null});
    const was = '{"id": 7, "status": "new", "big": 9007199254740993}';
    assert.deepStrictEqual(sql_change_from_ask({collection: 'orders', id: {id: 7}, document: '{"id": 7, "status": "paid", "big": 9007199254740993, "note": "x"}', was}), {collection: 'orders', id: {id: 7}, set: {status: 'paid', note: 'x'}, was: {status: 'new'}});
    assert.deepStrictEqual(sql_change_from_ask({collection: 'orders', id: {id: 7}, document: '{"status": "paid"}'}).set, {status: 'paid'}, 'without the row as read, every column given');
    assert.deepStrictEqual(sql_change_from_ask({collection: 'orders', id: {id: 7}}), {collection: 'orders', id: {id: 7}, set: null, was: null});

    const refusals = [
        [{collection: 'orders', document: '[1]'}, /^the row is a JSON object of its columns/],
        [{collection: 'orders', document: 'null'}, /^the row is a JSON object of its columns/],
        [{collection: 'orders', document: '{status: 1}'}, /^the row is no JSON: /],
        [{collection: 'orders', id: {id: 7}, document: '{}', was: '['}, /^the row as it was read is no JSON: /],
        [{collection: 'orders', id: 7}, /^id names the row by its key/],
        [{collection: 'orders', id: {}}, /^id names the row by its key/],
        [{collection: 'orders', id: [7]}, /^id names the row by its key/],
        [{collection: 'orders', id: null}, /^id names the row by its key/],
    ];
    for (const [ask, said] of refusals) {
        assert.throws(() => sql_change_from_ask(ask), {status: 400, message: said}, JSON.stringify(ask));
    }
});

// Why an edit was not saved: each column another hand changed, with what it holds now, a long
// value cut
test('another hand\'s change is said with what each column holds now', function () {
    assert.strictEqual(changed_said_of(['status', 'big'], {status: 'shipped', big: {$numberLong: '9007199254740993'}}), 'it changed since it was read, by another hand: status is "shipped" now, big is 9007199254740993 now');
    assert.strictEqual(changed_said_of(['note'], {note: 'x'.repeat(100)}), `it changed since it was read, by another hand: note is "${'x'.repeat(58)}… now`);
    assert.strictEqual(changed_said_of(['gone'], {}), 'it changed since it was read, by another hand: gone is null now');
});
