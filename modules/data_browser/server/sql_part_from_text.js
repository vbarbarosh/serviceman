// A part of a SQL statement as typed into the page, ready to go into the statement it is a part
// of: trimmed, a semicolon at its end dropped, and so is the keyword it was typed after by habit,
// `WHERE` before a condition, `ORDER BY` before a sort. Nothing else of it is changed: it is SQL
// its database's user runs, with that user's rights, and the engine reads it.
//
//     sql_part_from_text(" WHERE status = 'active'; ", 'WHERE')   // "status = 'active'"
//     sql_part_from_text('SELECT 1;\n', '')                       // 'SELECT 1'
function sql_part_from_text(text, keyword)
{
    const trimmed = String(text).trim().replace(/(\s*;)+$/, '');
    if (keyword === '') {
        return trimmed;
    }
    return trimmed.replace(new RegExp(`^${keyword.replace(' ', '\\s+')}\\s+`, 'i'), '');
}

module.exports = sql_part_from_text;
