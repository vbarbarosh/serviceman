const assert = require('assert');
const sql_part_from_text = require('../server/sql_part_from_text');
const test = require('node:test');

// A part of a statement as typed: trimmed, its trailing semicolons and the keyword typed before
// it by habit dropped, nothing else changed
test('a part typed is trimmed of its semicolon and the keyword typed before it', function () {
    const parts = [
        [' WHERE status = \'active\'; ', 'WHERE', 'status = \'active\''],
        ['where_at > 1', 'WHERE', 'where_at > 1'],
        ['order  by\njoined DESC ;; ', 'ORDER BY', 'joined DESC'],
        ['SELECT 1;\n', '', 'SELECT 1'],
        ['SELECT \';\' AS s; DELETE FROM t', '', 'SELECT \';\' AS s; DELETE FROM t'],
        ['', 'WHERE', ''],
    ];
    for (const [text, keyword, part] of parts) {
        assert.strictEqual(sql_part_from_text(text, keyword), part, text);
    }
});
