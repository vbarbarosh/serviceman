const ejson_number_from_text = require('./ejson_number_from_text');

// JSON text as relaxed Extended JSON: what JSON.parse reads, but each number kept whole from the
// digits it was written with (ejson_number_from_text), where JSON.parse would round a bigint or
// drop a decimal's trailing zero. A SQL engine's rows come as JSON with such numbers in them.
//
//     ejson_from_json('{"big": 9007199254740993, "price": 1.10}')
//     // {big: {$numberLong: '9007199254740993'}, price: {$numberDecimal: '1.10'}}
function ejson_from_json(text)
{
    return JSON.parse(text, (key, value, context) => ((typeof value === 'number') ? ejson_number_from_text(context.source) : value));
}

module.exports = ejson_from_json;
