const assert = require('assert');
const ejson_from_text = require('../server/ejson_from_text');
const test = require('node:test');

test('a query is read as the shell types it, its types as Extended JSON', function () {
    assert.deepStrictEqual(ejson_from_text(''), {});
    assert.deepStrictEqual(ejson_from_text('  '), {});
    assert.deepStrictEqual(ejson_from_text('{"status": "active"}'), {status: 'active'});
    assert.deepStrictEqual(ejson_from_text('{status: \'active\', n: {$gte: 2, $lt: 1.5e3}, ok: true, gone: null,}'), {status: 'active', n: {$gte: 2, $lt: 1500}, ok: true, gone: null});
    assert.deepStrictEqual(ejson_from_text('{"address.city": \'Kyiv\', tags: {$in: ["a", \'b\']}}'), {'address.city': 'Kyiv', tags: {$in: ['a', 'b']}});
    assert.deepStrictEqual(ejson_from_text('{_id: ObjectId(\'6B08111DA665B663B25BA166\')}'), {_id: {$oid: '6b08111da665b663b25ba166'}});
    assert.deepStrictEqual(ejson_from_text('{at: {$gt: ISODate("2026-01-01"), $lt: new Date(\'2026-02-01T10:00:00Z\')}}'), {at: {$gt: {$date: '2026-01-01T00:00:00.000Z'}, $lt: {$date: '2026-02-01T10:00:00.000Z'}}});
    assert.deepStrictEqual(ejson_from_text('{a: NumberLong(\'9007199254740993\'), b: NumberInt(7), c: NumberDecimal("1.10"), d: 9007199254740993}'), {a: {$numberLong: '9007199254740993'}, b: {$numberInt: '7'}, c: {$numberDecimal: '1.10'}, d: {$numberLong: '9007199254740993'}});
    assert.deepStrictEqual(ejson_from_text('{u: UUID("6d216dd0d1cf4376b8c4e5f69308c445")}'), {u: {$uuid: '6d216dd0-d1cf-4376-b8c4-e5f69308c445'}});
    assert.deepStrictEqual(ejson_from_text('{name: /^ab\\/c[/]d/mi}'), {name: {$regularExpression: {pattern: '^ab\\/c[/]d', options: 'im'}}});
    assert.deepStrictEqual(ejson_from_text('{s: "a\\n\\"b\\" \\u00e9", t: \'it\\\'s\'}'), {s: 'a\n"b" é', t: 'it\'s'});
    assert.deepStrictEqual(ejson_from_text('// the active ones\n{status: "active" /* for now */}'), {status: 'active'});
    assert.deepStrictEqual(ejson_from_text('[1, -2, .5]'), [1, -2, 0.5]);
});

test('anything that is no value is refused, with what is wrong and where', function () {
    const cases = [
        ['{a: db.dropDatabase()}', /^"db\.dropDatabase" is not a value: a query is data, the shell's types \(ObjectId, ISODate, NumberLong…\) and no code, at 5$/],
        ['{a: function () {}}', /^"function" is not a value/],
        ['{a: new Function("x")}', /^"Function" is not a value/],
        ['{a: this}', /^"this" is not a value/],
        ['{a: 1} {b: 2}', /^something after the end, at 8$/],
        ['{a: 1', /^a comma or } was expected, at 6$/],
        ['{a 1}', /^: was expected, at 4$/],
        ['{a: "b}', /^a string is not closed, at 8$/],
        ['{\n  a: 1,\n  b: }', /^"}" begins no value, on line 3, at 6$/],
        ['{a: ObjectId("xyz")}', /^an ObjectId is 24 hex digits/],
        ['{a: ISODate("not a date")}', /^no date can be read from it/],
        ['{a: NumberInt(3000000000)}', /^a NumberInt is a whole number of 32 bits/],
        ['{a: 123456789012345678901234}', /^a whole number of more than 64 bits/],
        ['{a: /x/g}', /^a regular expression takes the flags i, m, s and x/],
        ['{a: "\\q"}', /^no such escape: \\q/],
    ];
    for (const [text, said] of cases) {
        assert.throws(() => ejson_from_text(text), function (error) {
            assert.match(error.message, said, text);
            assert.strictEqual(error.status, 400);
            return true;
        });
    }
});
