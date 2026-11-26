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
        ['documents', 'id = 1; DELETE FROM items', /^You have an error in your SQL syntax; .* near '; DELETE FROM items \) LIMIT 0' at line 2$/],
        ['documents', '1) ; DROP TABLE items; SELECT * FROM items WHERE (1', /^You have an error in your SQL syntax/],
        ['documents', 'wipe() = 1', /^it writes, and this page changes nothing for now: Cannot execute statement in a READ ONLY transaction\.$/],
        ['aggregate', 'SELECT * FROM items FOR UPDATE', /^it writes, and this page changes nothing for now: Cannot execute statement in a READ ONLY transaction\.$/],
        ['aggregate', 'DELETE FROM items', /^only what one SELECT gives is read here, and this page changes nothing for now: You have an error in your SQL syntax/],
        ['aggregate', 'DROP TABLE items', /^only what one SELECT gives is read here, and this page changes nothing for now: You have an error in your SQL syntax/],
        ['aggregate', 'COMMIT', /^only what one SELECT gives is read here/],
        ['aggregate', 'SET SESSION transaction_read_only = OFF', /^only what one SELECT gives is read here/],
        ['aggregate', 'SELECT wipe()', /^it writes, and this page changes nothing for now: Cannot execute statement in a READ ONLY transaction\.$/],
    ];
    for (const [door, text, said] of refused) {
        const ask = (door === 'documents') ? {collection: 'items', filter: text, sort: '', fields: '', skip: 0, limit: 50} : {collection: 'items', pipeline: text, skip: 0, limit: 50};
        await assert.rejects(adapter[door](ask), {status: 400, message: said}, text);
    }
    assert.strictEqual((await adapter.collections()).find(v => v.name === 'items').count, 122, 'as many as before');
    assert.strictEqual(adapter.insert, undefined, 'its rows are read alone for now');
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
    const options = `--default-character-set=utf8mb4 --binary-as-hex -h 127.0.0.1 -u ${DATABASE} ${DATABASE}`;
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
