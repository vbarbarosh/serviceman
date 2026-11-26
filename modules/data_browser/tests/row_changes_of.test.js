const assert = require('assert');
const row_changes_of = require('../server/row_changes_of');
const test = require('node:test');

// The columns of a row as edited whose values are not those it was read with; a column left out
// is left as it is, one added is a change
test('the columns changed are those whose values differ from what was read', function () {
    const was = {id: 7, name: 'a', price: {$numberDecimal: '2.50'}, doc: {a: [1, {b: 2}]}, note: null};
    assert.deepStrictEqual(row_changes_of(was, {id: 7, name: 'a', price: {$numberDecimal: '2.50'}, doc: {a: [1, {b: 2}]}, note: null}), {});
    assert.deepStrictEqual(row_changes_of(was, {id: 7, name: 'b', price: 2.5, doc: {a: [1, {b: 3}]}, note: ''}), {name: 'b', price: 2.5, doc: {a: [1, {b: 3}]}, note: ''});
    assert.deepStrictEqual(row_changes_of(was, {name: 'a'}), {}, 'a column left out is left as it is');
    assert.deepStrictEqual(row_changes_of(was, {extra: 1}), {extra: 1}, 'a column not read is a change');
    assert.deepStrictEqual(row_changes_of({doc: {a: 1, b: 2}}, {doc: {b: 2, a: 1}}), {}, 'keys in another order are the same object');
    assert.deepStrictEqual(row_changes_of({doc: [1, 2]}, {doc: {0: 1, 1: 2}}), {doc: {0: 1, 1: 2}}, 'a list is no object');
    assert.deepStrictEqual(row_changes_of({n: null}, {n: 0}), {n: 0}, 'null is no 0');
});
