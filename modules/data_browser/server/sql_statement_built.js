// A page's statement from its pieces: the adapter's own text, and the parts typed, {word, text};
// with where each part stands in it, {word, from, to}, `to` just past its last character, for an
// engine's syntax error in it (sql_part_at)
//
//     sql_statement_built(['SELECT * FROM "big" WHERE (\n', {word: 'condition', text: 'n < 0'}, '\n)'])
//     // {statement: 'SELECT * FROM "big" WHERE (\nn < 0\n)', parts: [{word: 'condition', from: 28, to: 33}]}
function sql_statement_built(pieces)
{
    let statement = '';
    const parts = [];
    for (const piece of pieces) {
        if (typeof piece === 'string') {
            statement += piece;
            continue;
        }
        parts.push({word: piece.word, from: statement.length, to: statement.length + piece.text.length});
        statement += piece.text;
    }
    return {statement, parts};
}

module.exports = sql_statement_built;
