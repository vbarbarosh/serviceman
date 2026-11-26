const assert = require('assert');
const sql_part_at = require('../server/sql_part_at');
const sql_statement_built = require('../server/sql_statement_built');
const test = require('node:test');

// A page's statement built from the adapter's text and the parts typed, and each place of it said
// of the part it is in or after: in the columns, past them in " FROM …", in the condition, past it
// at its ")" and in what follows it, and before anything typed
test('a place in a statement is in a part typed, past one, or before them all', function () {
    const built = sql_statement_built(['SELECT ', '\n', {word: 'columns', text: 'id,'}, '\n', ' FROM "big"', ' WHERE (\n', {word: 'condition', text: 'n <'}, '\n)', ' LIMIT ? OFFSET ?']);
    assert.strictEqual(built.statement, 'SELECT \nid,\n FROM "big" WHERE (\nn <\n) LIMIT ? OFFSET ?');
    assert.deepStrictEqual(built.parts, [{word: 'columns', from: 8, to: 11}, {word: 'condition', from: 32, to: 35}]);
    const said = [0, 8, 10, 11, 13, 31, 32, 34, 35, 36, 50].map(function (at) {
        const part = sql_part_at(built.parts, at);
        return (part === null) ? `${at} before` : `${at} ${part.past ? 'past' : 'in'} ${part.word}`;
    });
    assert.deepStrictEqual(said, ['0 before', '8 in columns', '10 in columns', '11 past columns', '13 past columns', '31 past columns', '32 in condition', '34 in condition', '35 past condition', '36 past condition', '50 past condition']);
    assert.strictEqual(sql_part_at([], 5), null);
});
