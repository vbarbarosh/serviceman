const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const mysql_adapter = require('../server/mysql_adapter');
const os = require('os');
const path = require('path');
const test = require('node:test');

// MySQL's adapter on a real MySQL, its scripts run by mysql in its container as a database's
// own user over 127.0.0.1, twice, the way serviceman runs them: for the column types, then for
// the rows as XML. DATA_BROWSER_MYSQL names the container, its root's password in
// DATA_BROWSER_MYSQL_ROOT; DATA_BROWSER_DOCKER the command, docker or podman. Skipped without
// them:
//
//     docker run -d --name mysql-test -e MYSQL_ROOT_PASSWORD=pw mysql:8.4
//     DATA_BROWSER_MYSQL=mysql-test DATA_BROWSER_MYSQL_ROOT=pw node --test modules/data_browser/tests
const CONTAINER = process.env.DATA_BROWSER_MYSQL;
const DOCKER = process.env.DATA_BROWSER_DOCKER || 'docker';
const DATABASE = 'browse_test';
const CHANGED = 'browse_change_test';

test('a real MySQL: its tables, a page of rows, a condition, an order, the columns, a query, and no write', {skip: (CONTAINER === undefined) && 'DATA_BROWSER_MYSQL names no container'}, async function () {
    mysql_root([
        `DROP DATABASE IF EXISTS ${DATABASE};`,
        `DROP USER IF EXISTS '${DATABASE}'@'%';`,
        `CREATE DATABASE ${DATABASE};`,
        `CREATE USER '${DATABASE}'@'%' IDENTIFIED BY 'pw';`,
        `GRANT ALL PRIVILEGES ON ${DATABASE}.* TO '${DATABASE}'@'%';`,
        `USE ${DATABASE};`,
        'CREATE TABLE items (id BIGINT PRIMARY KEY, name VARCHAR(50), price DECIMAL(10,2), big BIGINT, ubig BIGINT UNSIGNED, ratio DOUBLE, flag BOOLEAN, bits BIT(8), born DATE, doc JSON, raw VARBINARY(4), KEY items_name (name));',
        'INSERT INTO items WITH RECURSIVE s (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < 120)',
        '    SELECT i, CONCAT(\'item \', i), i * 1.25, 9007199254740993 + i, 18446744073709551615 - i, i / 4, i % 2 = 0, i, DATE \'2026-01-01\' + INTERVAL i DAY, JSON_OBJECT(\'n\', i, \'big\', 12345678901234567890), UNHEX(\'00FF\') FROM s;',
        'INSERT INTO items (id, name, doc) VALUES (1000, NULL, NULL), (1001, \'NULL\', \'{"html": "<b>x</b> & y"}\');',
        'CREATE TABLE `empty` (id INT);',
        'CREATE VIEW evens AS SELECT id, name FROM items WHERE flag;',
        'CREATE TABLE `Order Lines` (`Line No` INT, qty INT);',
        'INSERT INTO `Order Lines` VALUES (1, 2), (2, 5);',
        'DELIMITER //',
        'CREATE FUNCTION wipe() RETURNS INT DETERMINISTIC MODIFIES SQL DATA BEGIN DELETE FROM items; RETURN 1; END //',
        'DELIMITER ;',
    ].join('\n'));
    const adapter = mysql_adapter(mysql_user);

    // Its tables and views, by name, each table's rows counted
    const collections = await adapter.collections();
    assert.deepStrictEqual(collections.map(v => `${v.name} ${v.type} ${v.count} ${v.estimated} ${v.indexes}`), ['empty table 0 false 0', 'evens view null false null', 'items table 122 false 2', 'Order Lines table 2 false 0']);
    assert.strictEqual(collections[2].bytes > 0, true);

    // A page of rows, each value read by its column's type, a number JavaScript would round kept
    // whole, NULL apart from the word NULL; one past the page says a next one is there
    const first = await adapter.documents({collection: 'items', filter: '', sort: 'id', fields: '', skip: 0, limit: 50});
    assert.deepStrictEqual([first.items.length, first.count, first.more, first.cut, first.items[0].id, first.items[49].id], [50, 122, true, false, 1, 50]);
    assert.deepStrictEqual(first.columns, ['id', 'name', 'price', 'big', 'ubig', 'ratio', 'flag', 'bits', 'born', 'doc', 'raw']);
    assert.deepStrictEqual(first.items[1], {id: 2, name: 'item 2', price: {$numberDecimal: '2.50'}, big: {$numberLong: '9007199254740995'}, ubig: {$numberDecimal: '18446744073709551613'}, ratio: 0.5, flag: 1, bits: 2, born: '2026-01-03', doc: {n: 2, big: {$numberDecimal: '12345678901234567890'}}, raw: '0x00FF'});
    const words = await adapter.documents({collection: 'items', filter: 'id >= 1000', sort: '', fields: 'id, name, doc', skip: 0, limit: 50});
    assert.deepStrictEqual(words.items, [{id: 1000, name: null, doc: null}, {id: 1001, name: 'NULL', doc: {html: '<b>x</b> & y'}}]);

    // A condition, an order and the columns as typed, the keywords typed by habit dropped
    const found = await adapter.documents({collection: 'items', filter: 'WHERE flag AND id >= 100;', sort: 'ORDER BY id DESC', fields: 'id, name', skip: 2, limit: 3});
    assert.deepStrictEqual([found.items, found.count, found.more], [[{id: 116, name: 'item 116'}, {id: 114, name: 'item 114'}, {id: 112, name: 'item 112'}], 11, true]);
    const spaced = await adapter.documents({collection: 'Order Lines', filter: '`Line No` > 1', sort: '', fields: '', skip: 0, limit: 50});
    assert.deepStrictEqual([spaced.items, spaced.more], [[{'Line No': 2, qty: 5}], false]);
    const view = await adapter.documents({collection: 'evens', filter: 'id < 7', sort: 'id', fields: '', skip: 0, limit: 50});
    assert.deepStrictEqual(view.items.map(v => v.id), [2, 4, 6]);

    // The query box: a SELECT whole, a page of it; a join's two columns of one name both kept
    const grouped = await adapter.aggregate({collection: 'items', pipeline: 'SELECT flag, COUNT(*) AS n, SUM(price) AS total FROM items WHERE flag IS NOT NULL GROUP BY flag ORDER BY flag;', skip: 0, limit: 50});
    assert.deepStrictEqual([grouped.items, grouped.count, grouped.more], [[{flag: 0, n: 60, total: {$numberDecimal: '4500.00'}}, {flag: 1, n: 60, total: {$numberDecimal: '4575.00'}}], null, false]);
    const joined = await adapter.aggregate({collection: 'items', pipeline: 'SELECT a.id, b.id, 3 AS `2024` FROM items a JOIN items b ON b.id = a.id + 1 ORDER BY a.id', skip: 10, limit: 2});
    assert.deepStrictEqual([joined.columns, joined.items, joined.more], [['id', 'id (2)', '2024'], [{'id': 11, 'id (2)': 12, '2024': 3}, {'id': 12, 'id (2)': 13, '2024': 3}], true]);
    const all = await adapter.aggregate({collection: 'Order Lines', pipeline: '', skip: 0, limit: 50});
    assert.deepStrictEqual(all.items.length, 2);

    // What is wrong is MySQL's words
    await assert.rejects(adapter.documents({collection: 'items', filter: 'nam = 1', sort: '', fields: '', skip: 0, limit: 50}), {status: 400, message: 'Unknown column \'nam\' in \'where clause\''});
    await assert.rejects(adapter.documents({collection: 'nothing', filter: '', sort: '', fields: '', skip: 0, limit: 50}), {status: 400, message: `Table '${DATABASE}.nothing' doesn't exist`});

    // Nothing is written: a DELETE, a DROP, a COMMIT, a lock or a function that deletes, typed
    // into a condition or the query box, are refused by MySQL itself, the statement prepared
    // alone and the transaction READ ONLY
    const refused = [
        ['documents', 'id = 1; DELETE FROM items', /^You have an error in your SQL syntax; .* near '; DELETE FROM items' at line 1$/],
        ['documents', '1) ; DROP TABLE items; SELECT * FROM items WHERE (1', /^You have an error in your SQL syntax/],
        ['documents', 'wipe() = 1', /^it writes, and what is typed here is only read, a row being changed by its own buttons: Cannot execute statement in a READ ONLY transaction\.$/],
        ['aggregate', 'SELECT * FROM items FOR UPDATE', /^it writes, and what is typed here is only read, a row being changed by its own buttons: Cannot execute statement in a READ ONLY transaction\.$/],
        ['aggregate', 'DELETE FROM items', /^only what one SELECT gives is read here, a row being changed by its own buttons: You have an error in your SQL syntax/],
        ['aggregate', 'DROP TABLE items', /^only what one SELECT gives is read here, a row being changed by its own buttons: You have an error in your SQL syntax/],
        ['aggregate', 'COMMIT', /^only what one SELECT gives is read here/],
        ['aggregate', 'SET SESSION transaction_read_only = OFF', /^only what one SELECT gives is read here/],
        ['aggregate', 'SELECT wipe()', /^it writes, and what is typed here is only read, a row being changed by its own buttons: Cannot execute statement in a READ ONLY transaction\.$/],
    ];
    for (const [door, text, said] of refused) {
        const ask = (door === 'documents') ? {collection: 'items', filter: text, sort: '', fields: '', skip: 0, limit: 50} : {collection: 'items', pipeline: text, skip: 0, limit: 50};
        await assert.rejects(adapter[door](ask), {status: 400, message: said}, text);
    }
    assert.strictEqual((await adapter.collections()).find(v => v.name === 'items').count, 122, 'as many as before');

    // A syntax error is said of what was typed: in it, MySQL's words, its quote cut at its end and
    // its line counted from its first; past it, at the end of the condition, the ORDER BY, the
    // columns or the query, never the statement around it
    const syntax_words = 'You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use';
    const syntax = [
        [{filter: 'name = = \'a\''}, `${syntax_words} near '= 'a'' at line 1`],
        [{filter: 'name = \'a\'\nAND id = = 1'}, `${syntax_words} near '= 1' at line 2`],
        [{filter: 'name = \'😀 abc'}, `${syntax_words} near ''😀 abc' at line 1`],
        [{filter: 'name ='}, `${syntax_words} at the end of the condition`],
        [{filter: 'id IN (1, 2'}, `${syntax_words} at the end of the condition`],
        [{filter: 'id > 1', sort: 'id DESC,'}, `${syntax_words} at the end of the ORDER BY`],
        [{fields: 'id,'}, `${syntax_words} at the end of the columns`],
        [{pipeline: 'SELECT * FROM items WHERE'}, `${syntax_words} at the end of the query`],
        [{pipeline: 'SELECT * FROM items WHERE id = = 1'}, `${syntax_words} near '= 1' at line 1`],
    ];
    for (const [typed, said] of syntax) {
        const door = (typed.pipeline === undefined) ? 'documents' : 'aggregate';
        const ask = Object.assign((door === 'documents') ? {collection: 'items', filter: '', sort: '', fields: ''} : {collection: 'items'}, {skip: 0, limit: 50}, typed);
        await assert.rejects(adapter[door](ask), {status: 400, message: said}, JSON.stringify(typed));
    }
});

// Rows changed by their table's key, in a database of their own: the table described first, each
// column found by name, each value in a hex literal of its own read by MySQL by its column's
// type; a change in a transaction of its own, strict; an edit saving the columns changed alone,
// and not over another hand's change; every refusal in MySQL's words
test('a real MySQL: a row added, edited by its key, deleted, and each refusal in its words', {skip: (CONTAINER === undefined) && 'DATA_BROWSER_MYSQL names no container'}, async function () {
    const sql_text_of = (await import('../ui/sql_text_of.js')).default;
    mysql_root([
        `DROP DATABASE IF EXISTS ${CHANGED};`,
        `DROP USER IF EXISTS '${CHANGED}'@'%';`,
        `CREATE DATABASE ${CHANGED};`,
        `CREATE USER '${CHANGED}'@'%' IDENTIFIED BY 'pw';`,
        `GRANT ALL PRIVILEGES ON ${CHANGED}.* TO '${CHANGED}'@'%';`,
        `USE ${CHANGED};`,
        'CREATE TABLE customers (email VARCHAR(100) NOT NULL, name VARCHAR(100) NOT NULL, UNIQUE KEY customers_email (email)) COLLATE utf8mb4_unicode_ci;',
        'CREATE TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY, customer VARCHAR(100) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT \'new\', total DECIMAL(10,2) NOT NULL DEFAULT 0, note TEXT, CONSTRAINT orders_total CHECK (total >= 0), CONSTRAINT orders_customer FOREIGN KEY (customer) REFERENCES customers (email)) COLLATE utf8mb4_unicode_ci;',
        'CREATE TABLE `lines` (order_id INT NOT NULL, line_no INT NOT NULL, qty INT NOT NULL, PRIMARY KEY (order_id, line_no), CONSTRAINT lines_order FOREIGN KEY (order_id) REFERENCES orders (id));',
        'CREATE TABLE kinds (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, born DATE, at DATETIME(3), stamp TIMESTAMP(6) NULL, price DECIMAL(12,2), big BIGINT, ubig BIGINT UNSIGNED, ratio DOUBLE, f FLOAT, flag BOOLEAN, bits BIT(8), doc JSON, blob_col BLOB, bin VARBINARY(4), t TIME, y YEAR, status ENUM(\'on\', \'off\'), doubled DECIMAL(13,2) AS (price * 2) STORED);',
        'CREATE TABLE coded (code CHAR(8) NOT NULL DEFAULT \'none\', n INT, PRIMARY KEY (code));',
        'CREATE TABLE events (at DATETIME, kind VARCHAR(20));',
        'CREATE TABLE visits (path VARCHAR(100), n INT, UNIQUE KEY visits_path (path));',
        'CREATE VIEW paid AS SELECT id, total FROM orders WHERE status = \'paid\';',
        'INSERT INTO customers VALUES (\'ann@example.com\', \'Ann\'), (\'bob@example.com\', \'Bob\');',
        'INSERT INTO orders (customer, total) VALUES (\'ann@example.com\', 10), (\'bob@example.com\', 20);',
        'INSERT INTO `lines` VALUES (1, 1, 2), (1, 2, 5);',
        'INSERT INTO kinds (born, at, stamp, price, big, ubig, ratio, f, flag, bits, doc, blob_col, bin, t, y, status) VALUES (\'2026-01-02\', \'2026-06-01 10:00:00.123\', \'2026-06-01 10:00:00.654321\', 2.50, 9007199254740993, 18446744073709551615, 0.1, 1.1, TRUE, 5, \'{"n": 1, "big": 12345678901234567890}\', UNHEX(\'00FF\'), UNHEX(\'0A0B\'), \'01:30:00\', 2026, \'on\');',
        'INSERT INTO kinds () VALUES ();',
    ].join('\n'));
    const adapter = mysql_adapter(v => mysql_as(CHANGED, v));
    // A row read whole by its key, as Edit shows it: the text an edit starts from
    async function row_text_read(collection, id) {
        const found = await adapter.document({collection, id});
        return sql_text_of(new Map(found.columns.map(v => [v, found.item[v]])), true);
    }

    // The key a row is named by: the primary key, else a unique key of NOT NULL columns; none
    // for a unique key of a column that may be NULL, and none for a view
    const keys = (await adapter.collections()).map(v => `${v.name} ${JSON.stringify(v.key)}`);
    assert.deepStrictEqual(keys, ['coded ["code"]', 'customers ["email"]', 'events null', 'kinds ["id"]', 'lines ["order_id","line_no"]', 'orders ["id"]', 'paid null', 'visits null']);
    assert.deepStrictEqual(await adapter.document({collection: 'orders', id: null}), {item: null, columns: ['id', 'customer', 'status', 'total', 'note'], key: ['id'], filled: ['id', 'status', 'total']});

    // + Row: the columns given, read by their types, defaults filling the rest, read back by its
    // AUTO_INCREMENT, by its key as given, by its key's default
    const added = await adapter.insert({collection: 'orders', document: '{"customer": "bob@example.com", "note": "\'); DROP TABLE orders; --"}'});
    assert.deepStrictEqual(added, {id: {id: 3}, item: {id: 3, customer: 'bob@example.com', status: 'new', total: {$numberDecimal: '0.00'}, note: '\'); DROP TABLE orders; --'}, saved: ['customer', 'note']});
    assert.deepStrictEqual((await adapter.insert({collection: 'customers', document: '{"email": "cid@example.com", "name": "Cid"}'})).id, {email: 'cid@example.com'});
    assert.deepStrictEqual((await adapter.insert({collection: 'coded', document: '{"n": 1}'})).item, {code: 'none', n: 1});

    // Every kind of value, written back as the page reads it, saves nothing; each changed saves
    // that column alone, read by its type
    const kinds = await row_text_read('kinds', {id: 1});
    assert.deepStrictEqual((await adapter.replace({collection: 'kinds', id: {id: 1}, document: kinds, was: kinds})).saved, []);
    const empty = await row_text_read('kinds', {id: 2});
    assert.deepStrictEqual((await adapter.replace({collection: 'kinds', id: {id: 2}, document: empty, was: empty})).saved, [], 'NULL is NULL');
    const edited = kinds.replace('"price": 2.50', '"price": 3.75').replace('"big": 9007199254740993', '"big": 9007199254740999').replace('"ubig": 18446744073709551615', '"ubig": 18446744073709551614').replace('"bin": "0x0A0B"', '"bin": "0xCAFE"').replace('"flag": 1', '"flag": true').replace('"bits": 5', '"bits": 255').replace('"doc": {"n": 1, "big": 12345678901234567890}', '"doc": "just text"');
    const saved = await adapter.replace({collection: 'kinds', id: {id: 1}, document: edited, was: kinds});
    assert.deepStrictEqual(saved.saved, ['price', 'big', 'ubig', 'flag', 'bits', 'doc', 'bin']);
    assert.deepStrictEqual([saved.item.price, saved.item.big, saved.item.ubig, saved.item.flag, saved.item.bits, saved.item.doc, saved.item.bin, saved.item.doubled], [3.75, {$numberLong: '9007199254740999'}, {$numberDecimal: '18446744073709551614'}, 1, 255, 'just text', '0xCAFE', {$numberDecimal: '7.50'}]);
    const again = await row_text_read('kinds', {id: 1});
    assert.deepStrictEqual((await adapter.replace({collection: 'kinds', id: {id: 1}, document: again, was: again})).saved, [], 'what was saved reads back the same');

    // Another hand's change: to a column this edit changes, said with what it holds now, even a
    // change of case alone, which the column's collation does not tell; to another column, kept,
    // and this edit's saved beside it
    const order = await row_text_read('orders', {id: 1});
    mysql_root(`USE ${CHANGED}; UPDATE orders SET status = 'shipped', note = 'by an app' WHERE id = 1;`);
    await assert.rejects(adapter.replace({collection: 'orders', id: {id: 1}, document: order.replace('"status": "new"', '"status": "paid"'), was: order}), {status: 409, message: 'it changed since it was read, by another hand: status is "shipped" now', changed: ['status']});
    const merged = await adapter.replace({collection: 'orders', id: {id: 1}, document: order.replace('"total": 10.00', '"total": 11.50'), was: order});
    assert.deepStrictEqual([merged.saved, merged.item.status, merged.item.note, merged.item.total], [['total'], 'shipped', 'by an app', {$numberDecimal: '11.50'}]);
    const ann = await row_text_read('customers', {email: 'ann@example.com'});
    mysql_root(`USE ${CHANGED}; UPDATE customers SET name = 'ANN' WHERE email = 'ann@example.com';`);
    await assert.rejects(adapter.replace({collection: 'customers', id: {email: 'ann@example.com'}, document: ann.replace('"name": "Ann"', '"name": "Anne"'), was: ann}), {status: 409, changed: ['name']});

    // A key changed is the row's new name; a row gone is said so
    const line = await row_text_read('lines', {order_id: 1, line_no: 2});
    const moved = await adapter.replace({collection: 'lines', id: {order_id: 1, line_no: 2}, document: line.replace('"line_no": 2', '"line_no": 9'), was: line});
    assert.deepStrictEqual(moved.id, {order_id: 1, line_no: 9});
    await assert.rejects(adapter.replace({collection: 'lines', id: {order_id: 1, line_no: 2}, document: line, was: line}), {status: 400, message: /^it is not there any more/});

    // Refused, in MySQL's words, nothing written
    const refusals = [
        ['insert', {collection: 'orders', document: '{"customer": null}'}, 400, 'Column \'customer\' cannot be null'],
        ['insert', {collection: 'orders', document: '{}'}, 400, 'Field \'customer\' doesn\'t have a default value'],
        ['insert', {collection: 'orders', document: '{"customer": "zed@example.com"}'}, 400, /^Cannot add or update a child row: a foreign key constraint fails \(`browse_change_test`\.`orders`, CONSTRAINT `orders_customer`/],
        ['insert', {collection: 'orders', document: '{"customer": "ann@example.com", "total": -1}'}, 400, 'Check constraint \'orders_total\' is violated.'],
        ['insert', {collection: 'orders', document: '{"customer": "ann@example.com", "total": "much"}'}, 400, 'Incorrect decimal value: \'much\' for column \'total\' at row 1'],
        ['insert', {collection: 'orders', document: '{"customer": "ann@example.com", "x`; DROP TABLE orders; --": 1}'}, 400, 'no column `x`; DROP TABLE orders; --` in orders'],
        ['insert', {collection: 'kinds', document: '{"doubled": 1}'}, 400, /^The value specified for generated column 'doubled' in table 'kinds' is not allowed\.$/],
        ['insert', {collection: 'kinds', document: '{"status": "maybe"}'}, 400, 'Data truncated for column \'status\' at row 1'],
        ['insert', {collection: 'kinds', document: '{"bin": "0xABC"}'}, 400, /^bin is binary data, written 0x and two hex digits a byte/],
        ['insert', {collection: 'kinds', document: '{"bits": "many"}'}, 400, /^bits is a number column \(bit\(8\)\)/],
        ['insert', {collection: 'customers', document: '[1]'}, 400, /^the row is a JSON object of its columns/],
        ['insert', {collection: 'events', document: '{"kind": "x"}'}, 405, 'events has no primary key, nor a unique key of NOT NULL columns, to name one row by: its rows are read alone'],
        ['insert', {collection: 'visits', document: '{"n": 1}'}, 405, /^visits has no primary key/],
        ['insert', {collection: 'paid', document: '{}'}, 405, 'paid is a view: its rows are changed in the tables it reads'],
        ['insert', {collection: 'nothing', document: '{}'}, 400, `no table called nothing in ${CHANGED}`],
        ['remove', {collection: 'orders', id: {id: 1}}, 400, /^Cannot delete or update a parent row: a foreign key constraint fails/],
        ['remove', {collection: 'lines', id: {order_id: 1}}, 400, 'a row of lines is named by its key: order_id, line_no'],
        ['remove', {collection: 'orders', id: {id: '1 OR 1 = 1'}}, 400, /^id is a number column \(int\): "1 OR 1 = 1" is none it holds$/],
        ['document', {collection: 'events', id: {at: 1}}, 405, /^events has no primary key/],
    ];
    for (const [method, ask, status, said] of refusals) {
        await assert.rejects(adapter[method](ask), {status, message: said}, `${method} ${JSON.stringify(ask)}`);
    }
    assert.deepStrictEqual((await adapter.collections()).map(v => `${v.name} ${v.count}`).slice(0, 6), ['coded 1', 'customers 3', 'events 0', 'kinds 2', 'lines 2', 'orders 3'], 'nothing refused was written');

    // Deleted by its key, answered with what it held; then gone
    assert.deepStrictEqual(await adapter.remove({collection: 'orders', id: {id: 3}}), {id: {id: 3}, item: added.item, saved: []});
    await assert.rejects(adapter.remove({collection: 'orders', id: {id: 3}}), {status: 400, message: /^it is not there any more/});

    // A row another transaction holds is waited for, then said so, nothing changed
    const holder = child_process.spawn(DOCKER, ['exec', '-e', 'MYSQL_PWD=pw', CONTAINER, 'mysql', '-h', '127.0.0.1', '-u', CHANGED, CHANGED, '-e', 'START TRANSACTION; SELECT id FROM orders WHERE id = 2 FOR UPDATE; DO SLEEP(10); COMMIT;'], {stdio: 'ignore'});
    try {
        await new Promise(v => setTimeout(v, 2000));
        await assert.rejects(adapter.remove({collection: 'orders', id: {id: 2}}), {status: 409, message: /^another transaction holds the row/});
    }
    finally {
        holder.kill();
    }
});

// MySQL quotes the statement from where it stopped, and says its line: found in what the client
// ran, past a part typed is at its end, and in one the quote is cut at its end and the line
// counted from its first; an emoji, which MySQL's words say as ?, is found as itself; a quote
// not found leaves MySQL's words as they were, and an empty one is the statement's end
test('a MySQL syntax error is said of what was typed, never of the statement around it', async function () {
    const words = 'You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use';
    function adapter_said(near) {
        return mysql_adapter(() => Promise.reject(Object.assign(new Error(`ERROR 1064 (42000) at line 9: ${words} near '${near}`), {stdout: ''})));
    }
    const find = {collection: 'big', filter: 'status = ', sort: '', fields: '', skip: 0, limit: 50};
    const cases = [
        [') LIMIT 0\' at line 3', find],
        ['= 1\n) LIMIT 0\' at line 2', Object.assign({}, find, {filter: 'status = = 1'})],
        ['= 1\n) LIMIT 0\' at line 3', Object.assign({}, find, {filter: 'status = 1\nAND n = = 1'})],
        ['\'? Zoë\n) LIMIT 0\' at line 2', Object.assign({}, find, {filter: 'name = \'😀 Zoë'})],
        ['FROM `big` WHERE (\nn = 1\n) LIMIT 0\' at line 3', Object.assign({}, find, {fields: 'id,', filter: 'n = 1'})],
        ['LIMIT 0\' at line 5', Object.assign({}, find, {filter: 'n = 1', sort: 'n DESC,'})],
        [') LIMIT 0\' at line 3', {collection: 'big', pipeline: 'SELECT * FROM big WHERE', skip: 0, limit: 50}],
        ['nothing like it\' at line 1', find],
        ['\' at line 3', find],
    ];
    const said = [];
    for (const [near, ask] of cases) {
        said.push(await adapter_said(near)[(ask.pipeline === undefined) ? 'documents' : 'aggregate'](ask).catch(e => `${e.status} ${e.message}`));
    }
    assert.deepStrictEqual(said, [
        `400 ${words} at the end of the condition`,
        `400 ${words} near '= 1' at line 1`,
        `400 ${words} near '= 1' at line 2`,
        `400 ${words} near ''😀 Zoë' at line 1`,
        `400 ${words} at the end of the columns`,
        `400 ${words} at the end of the ORDER BY`,
        `400 ${words} at the end of the query`,
        `400 ${words} near 'nothing like it' at line 1`,
        `400 ${words} at the end of the condition`,
    ]);
});

// A script run as root, by the client in the container
function mysql_root(script)
{
    return client(['mysql', '--default-character-set=utf8mb4', '-uroot'], `MYSQL_PWD=${process.env.DATA_BROWSER_MYSQL_ROOT}`, script);
}

// A script run as the database's own user over 127.0.0.1, its password in the env, the way
// serviceman runs it: first for its column types, then for its rows as XML
async function mysql_user(script)
{
    return mysql_as(DATABASE, script);
}

// A script run as the user of a database of the same name, as mysql_user runs it
function mysql_as(database, script)
{
    const options = `--default-character-set=utf8mb4 --binary-as-hex -h 127.0.0.1 -u ${database} ${database}`;
    return client(['sh', '-c', `mysql ${options} -t --column-type-info --init-command='SET @serviceman_types = 1' < "$1" && mysql ${options} --xml < "$1"`, 'sh'], 'MYSQL_PWD=pw', script);
}

// The script copied into the container as a file, as serviceman puts it there, and run
function client(cmd, env, script)
{
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'data-browser-')), 'script.sql');
    fs.writeFileSync(file, script);
    const inside = `/tmp/data-browser-${path.basename(path.dirname(file))}.sql`;
    child_process.execFileSync(DOCKER, ['cp', file, `${CONTAINER}:${inside}`]);
    const args = (cmd[0] === 'sh') ? cmd.concat([inside]) : ['sh', '-c', `${cmd.join(' ')} < "$1"`, 'sh', inside];
    try {
        return child_process.execFileSync(DOCKER, ['exec', '-e', env, CONTAINER].concat(args), {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    }
    catch (error) {
        throw Object.assign(new Error(String(error.stderr).trim()), {stdout: String(error.stdout)});
    }
    finally {
        child_process.execFileSync(DOCKER, ['exec', CONTAINER, 'rm', '-f', inside]);
    }
}
