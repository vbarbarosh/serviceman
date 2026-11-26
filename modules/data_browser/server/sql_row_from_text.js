const ejson_from_json = require('./ejson_from_json');

// A SQL row as typed into the page, JSON, as an object of its columns' values: each number kept
// whole from its digits (ejson_from_json), as the page wrote it. What is wrong with it is a
// refusal of the ask (400), saying which text it is.
//
//     sql_row_from_text('{"id": 9007199254740993, "price": 2.50}', 'row')
//     // {id: {$numberLong: '9007199254740993'}, price: {$numberDecimal: '2.50'}}
//     sql_row_from_text('[1]', 'row')   // throws: the row is a JSON object of its columns, …
function sql_row_from_text(text, what)
{
    let out;
    try {
        out = ejson_from_json(String(text));
    }
    catch (error) {
        throw Object.assign(new Error(`the ${what} is no JSON: ${error.message}`), {status: 400});
    }
    if ((out === null) || (typeof out !== 'object') || Array.isArray(out)) {
        throw Object.assign(new Error(`the ${what} is a JSON object of its columns, {"name": "…"}`), {status: 400});
    }
    return out;
}

module.exports = sql_row_from_text;
