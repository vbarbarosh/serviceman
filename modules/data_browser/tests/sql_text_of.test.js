const assert = require('assert');
const test = require('node:test');

// A SQL row as the page writes it, JSON with the digits its engine gave, the columns in their
// order; and its cells, coloured as a MongoDB document's
test('a SQL row is written as JSON with its numbers whole, and its cells as the table shows them', async function () {
    const sql_text_of = (await import('../ui/sql_text_of.js')).default;
    const sql_cell_of = (await import('../ui/sql_cell_of.js')).default;
    const row = new Map([['2024', 1], ['id', {$numberLong: '9007199254740993'}], ['price', {$numberDecimal: '2.50'}], ['name', 'a "quoted" name'], ['note', null], ['flag', true], ['doc', {n: {$numberDecimal: '1.10'}, tags: ['a', 'b']}], ['$oid', {$oid: 'x'}]]);
    assert.strictEqual(sql_text_of(row, true), [
        '{',
        '    "2024": 1,',
        '    "id": 9007199254740993,',
        '    "price": 2.50,',
        '    "name": "a \\"quoted\\" name",',
        '    "note": null,',
        '    "flag": true,',
        '    "doc": {"n": 1.10, "tags": ["a", "b"]},',
        '    "$oid": {"$oid": "x"}',
        '}',
    ].join('\n'));
    assert.strictEqual(sql_text_of([new Map([['a', 1]]), new Map([['a', 2]])], true), '[\n    {"a": 1},\n    {"a": 2}\n]');
    assert.strictEqual(sql_text_of({}, false), '{}');
    assert.strictEqual(sql_text_of({long: 'x'.repeat(80)}, false), `{\n    "long": "${'x'.repeat(80)}"\n}`);

    const cells = [{$numberDecimal: '2.50'}, {$numberLong: '9007199254740993'}, 3, 'text', '', null, false, [1, 2], {a: {$numberDecimal: '1.10'}}, {$date: '2026-01-01'}, undefined];
    assert.deepStrictEqual(cells.map(v => sql_cell_of(v)), [
        {text: '2.50', kind: 'number', title: ''},
        {text: '9007199254740993', kind: 'number', title: ''},
        {text: '3', kind: 'number', title: ''},
        {text: 'text', kind: 'string', title: ''},
        {text: '""', kind: 'null', title: ''},
        {text: 'null', kind: 'null', title: ''},
        {text: 'false', kind: 'bool', title: ''},
        {text: '[1, 2]', kind: 'array', title: '2 items'},
        {text: '{"a": 1.10}', kind: 'object', title: '1 key'},
        {text: '{"$date": "2026-01-01"}', kind: 'object', title: '1 key'},
        {text: '', kind: 'none', title: 'not in this row'},
    ]);
});
