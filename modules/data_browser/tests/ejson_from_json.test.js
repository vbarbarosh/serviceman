const assert = require('assert');
const ejson_from_json = require('../server/ejson_from_json');
const ejson_number_from_text = require('../server/ejson_number_from_text');
const test = require('node:test');

// A number as a SQL engine writes it keeps its digits: a plain number where JavaScript holds it
// and writes it back the same, else its digits as they came
test('a number an engine wrote is kept whole, a float as the number it is', function () {
    const numbers = [
        ['42', 42],
        ['-7', -7],
        ['0', 0],
        ['9007199254740991', 9007199254740991],
        ['9007199254740993', {$numberLong: '9007199254740993'}],
        ['-9223372036854775808', {$numberLong: '-9223372036854775808'}],
        ['9223372036854775808', {$numberDecimal: '9223372036854775808'}],
        ['18446744073709551615', {$numberDecimal: '18446744073709551615'}],
        ['1.25', 1.25],
        ['2.50', {$numberDecimal: '2.50'}],
        ['0.10', {$numberDecimal: '0.10'}],
        ['-0.01', -0.01],
        ['12345678901234567890.123456789', {$numberDecimal: '12345678901234567890.123456789'}],
        ['1.5e-07', 1.5e-7],
        ['1e+100', 1e100],
        ['3.4E38', 3.4e38],
    ];
    for (const [text, number] of numbers) {
        assert.deepStrictEqual(ejson_number_from_text(text), number, text);
    }
});

test('JSON is read with its numbers kept whole, at any depth', function () {
    const json = '{"id": 9007199254740993, "price": 1.10, "n": 3, "doc": {"list": [1, 2.50, null, "x", true]}, "s": "12.30"}';
    assert.deepStrictEqual(ejson_from_json(json), {id: {$numberLong: '9007199254740993'}, price: {$numberDecimal: '1.10'}, n: 3, doc: {list: [1, {$numberDecimal: '2.50'}, null, 'x', true]}, s: '12.30'});
    assert.deepStrictEqual(ejson_from_json('[]'), []);
    assert.throws(() => ejson_from_json('<b>'), SyntaxError);
});
