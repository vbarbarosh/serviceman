const assert = require('assert');
const items_from_rows = require('../server/items_from_rows');
const test = require('node:test');

// A page of rows as objects keyed by column, the names in order: a name two columns have, a
// join's, is kept for both, the second numbered
test('rows become objects keyed by column, a name met twice made its own', function () {
    assert.deepStrictEqual(items_from_rows(['id', 'name', 'id', 'id'], [[1, 'a', 7, 8], [2, null]]), {
        columns: ['id', 'name', 'id (2)', 'id (3)'],
        items: [{'id': 1, 'name': 'a', 'id (2)': 7, 'id (3)': 8}, {'id': 2, 'name': null, 'id (2)': null, 'id (3)': null}],
    });
    assert.deepStrictEqual(items_from_rows(['a', 'a (2)', 'a'], [[1, 2, 3]]).columns, ['a', 'a (2)', 'a (3)']);
    assert.deepStrictEqual(items_from_rows(['2024', 'name'], [[1, 'x']]).columns, ['2024', 'name'], 'the order a number-named column has');
    assert.deepStrictEqual(items_from_rows([], []), {columns: [], items: []});
});
