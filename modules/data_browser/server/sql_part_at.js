// Which part typed into a statement a position of it stands in, or comes after: what an engine's
// syntax error there is said of, so the page never quotes the text the browser put around what
// was typed. `parts` are those typed, in the order they stand in the statement, each {word,
// from, to}, `to` just past its last character; `at` and the parts in the engine's own unit.
// Answers the part with `past` true when `at` is after its end (in the text after it, before the
// next part typed); null when `at` is before the first.
//
//     sql_part_at([{word: 'condition', from: 34, to: 43}], 40)   // {word: 'condition', from: 34, to: 43, past: false}
//     sql_part_at([{word: 'condition', from: 34, to: 43}], 44)   // {word: 'condition', from: 34, to: 43, past: true}
//     sql_part_at([{word: 'condition', from: 34, to: 43}], 10)   // null
function sql_part_at(parts, at)
{
    let out = null;
    for (const part of parts) {
        if (at < part.from) {
            break;
        }
        out = Object.assign({}, part, {past: (at >= part.to)});
    }
    return out;
}

module.exports = sql_part_at;
