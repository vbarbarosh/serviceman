const assert = require('assert');
const ejson_from_json = require('../server/ejson_from_json');
const json_from_ejson = require('../server/json_from_ejson');
const test = require('node:test');

// What ejson_from_json reads is written back the same: a number kept whole by its digits, for a
// SQL engine to read exactly; anything else as JSON writes it
test('a value is written as JSON, a number kept whole by its digits', function () {
    const values = [
        [{big: {$numberLong: '9007199254740993'}, price: {$numberDecimal: '2.50'}}, '{"big":9007199254740993,"price":2.50}'],
        [[1, {$numberDecimal: '12345678901234567890'}, null, 'x'], '[1,12345678901234567890,null,"x"]'],
        [{$numberLong: '1); DROP TABLE x'}, '{"$numberLong":"1); DROP TABLE x"}'],
        [{$numberDecimal: '2.50', other: 1}, '{"$numberDecimal":"2.50","other":1}'],
        ['a "quoted" \\ text\n', '"a \\"quoted\\" \\\\ text\\n"'],
        [{a: undefined, b: true}, '{"b":true}'],
        [null, 'null'],
        [1.5e-7, '1.5e-7'],
    ];
    for (const [value, json] of values) {
        assert.strictEqual(json_from_ejson(value), json, json);
    }
    const text = '{"id": 9007199254740993, "price": 2.50, "doc": {"n": [1, 12345678901234567890]}, "ratio": 0.1}';
    assert.strictEqual(json_from_ejson(ejson_from_json(text)), '{"id":9007199254740993,"price":2.50,"doc":{"n":[1,12345678901234567890]},"ratio":0.1}', 'read and written back, its digits the same');
    assert.throws(() => json_from_ejson({n: Infinity}), {status: 400, message: 'Infinity is no number JSON holds: write it as text, "Infinity"'});
});
