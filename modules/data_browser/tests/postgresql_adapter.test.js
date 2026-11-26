const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const postgresql_adapter = require('../server/postgresql_adapter');
const test = require('node:test');

// PostgreSQL's adapter on a real PostgreSQL, its scripts run by psql in its container as a
// database's own user over 127.0.0.1, the way serviceman runs them. DATA_BROWSER_POSTGRES names
// the container, its root's password in DATA_BROWSER_POSTGRES_ROOT; DATA_BROWSER_DOCKER the
// command, docker or podman. Skipped without them:
//
//     docker run -d --name postgres-test -e POSTGRES_PASSWORD=pw postgres:17
//     DATA_BROWSER_POSTGRES=postgres-test DATA_BROWSER_POSTGRES_ROOT=pw node --test modules/data_browser/tests
const CONTAINER = process.env.DATA_BROWSER_POSTGRES;
const DOCKER = process.env.DATA_BROWSER_DOCKER || 'docker';
const DATABASE = 'browse_test';
const CHANGED = 'browse_change_test';

test('a real PostgreSQL: its tables, a page of rows, a condition, an order, the columns, a query, and no write', {skip: (CONTAINER === undefined) && 'DATA_BROWSER_POSTGRES names no container'}, async function () {
    psql('postgres', 'postgres', process.env.DATA_BROWSER_POSTGRES_ROOT, [
        `DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE);`,
        `DROP ROLE IF EXISTS ${DATABASE};`,
        `CREATE ROLE ${DATABASE} WITH LOGIN PASSWORD 'pw';`,
        `CREATE DATABASE ${DATABASE} OWNER ${DATABASE};`,
        `REVOKE ALL ON DATABASE ${DATABASE} FROM PUBLIC;`,
    ].join('\n'));
    psql(DATABASE, 'postgres', process.env.DATA_BROWSER_POSTGRES_ROOT, [
        `SET ROLE ${DATABASE};`,
        'CREATE TABLE items (id bigint PRIMARY KEY, name text, price numeric(10,2), big bigint, ratio float8, flag boolean, born date, doc jsonb, tags text[]);',
        'INSERT INTO items SELECT i, \'item \' || i, i * 1.25, 9007199254740993 + i, i / 4.0, i % 2 = 0, DATE \'2026-01-01\' + i, jsonb_build_object(\'n\', i, \'big\', 12345678901234567890), ARRAY[\'a\'] FROM generate_series(1, 120) AS i;',
        'INSERT INTO items (id, name) VALUES (1000, NULL);',
        'CREATE INDEX items_name ON items (name);',
        'CREATE SEQUENCE items_seq;',
        'CREATE TABLE empty (id int);',
        'CREATE VIEW evens AS SELECT id, name FROM items WHERE flag;',
        'CREATE TABLE "Order Lines" ("Line No" int, qty int);',
        'INSERT INTO "Order Lines" VALUES (1, 2), (2, 5);',
        'CREATE SCHEMA archive;',
        'CREATE TABLE archive.orders (id int, total numeric(10,2));',
        'INSERT INTO archive.orders VALUES (1, 10.50);',
        'RESET ROLE;',
        'CREATE SCHEMA locked;',
        'CREATE TABLE locked.secrets (id int);',
        'INSERT INTO locked.secrets VALUES (1), (2);',
        'ANALYZE locked.secrets;',
    ].join('\n'));
    const adapter = postgresql_adapter(v => psql(DATABASE, DATABASE, 'pw', v));

    // Its tables and views, public's first; one its user may not read is still listed, as the
    // database's head counts it, its rows as PostgreSQL estimates them
    const collections = await adapter.collections();
    assert.deepStrictEqual(collections.map(v => `${v.name} ${v.type} ${v.count} ${v.estimated} ${v.indexes}`), ['empty table 0 false 0', 'evens view null false null', 'items table 121 false 2', 'Order Lines table 2 false 0', 'archive.orders table 1 false 0', 'locked.secrets table 2 true 0']);
    assert.strictEqual(collections[2].bytes > 0, true);

    // A page of rows, each value as PostgreSQL gives it in JSON, a number JavaScript would round
    // kept whole; one past the page says a next one is there
    const first = await adapter.documents({collection: 'items', filter: '', sort: 'id', fields: '', skip: 0, limit: 50});
    assert.deepStrictEqual([first.items.length, first.count, first.more, first.cut, first.items[0].id, first.items[49].id], [50, 121, true, false, 1, 50]);
    assert.deepStrictEqual(first.columns, ['id', 'name', 'price', 'big', 'ratio', 'flag', 'born', 'doc', 'tags']);
    assert.deepStrictEqual(first.items[1], {id: 2, name: 'item 2', price: {$numberDecimal: '2.50'}, big: {$numberLong: '9007199254740995'}, ratio: 0.5, flag: true, born: '2026-01-03', doc: {n: 2, big: {$numberDecimal: '12345678901234567890'}}, tags: ['a']});

    // A condition, an order and the columns as typed, the keywords typed by habit dropped
    const found = await adapter.documents({collection: 'items', filter: 'WHERE flag AND id >= 100;', sort: 'ORDER BY id DESC', fields: 'id, name', skip: 2, limit: 3});
    assert.deepStrictEqual([found.items, found.count, found.more], [[{id: 116, name: 'item 116'}, {id: 114, name: 'item 114'}, {id: 112, name: 'item 112'}], 11, true]);
    const nulls = await adapter.documents({collection: 'items', filter: 'name IS NULL', sort: '', fields: '', skip: 0, limit: 50});
    assert.deepStrictEqual([nulls.items[0].id, nulls.items[0].price, nulls.items[0].doc, nulls.count, nulls.more], [1000, null, null, 1, false]);
    const spaced = await adapter.documents({collection: 'Order Lines', filter: '"Line No" > 1', sort: '', fields: '', skip: 0, limit: 50});
    assert.deepStrictEqual(spaced.items, [{'Line No': 2, qty: 5}]);
    const schema = await adapter.documents({collection: 'archive.orders', filter: '', sort: '', fields: '', skip: 0, limit: 50});
    assert.deepStrictEqual(schema.items, [{id: 1, total: {$numberDecimal: '10.50'}}]);
    const view = await adapter.documents({collection: 'evens', filter: 'id < 7', sort: 'id', fields: '', skip: 0, limit: 50});
    assert.deepStrictEqual(view.items.map(v => v.id), [2, 4, 6]);

    // The query box: a SELECT whole, a page of it; a join's two columns of one name both kept
    const grouped = await adapter.aggregate({collection: 'items', pipeline: 'SELECT flag, count(*) AS n FROM items WHERE flag IS NOT NULL GROUP BY flag ORDER BY flag;', skip: 0, limit: 50});
    assert.deepStrictEqual([grouped.items, grouped.count, grouped.more], [[{flag: false, n: 60}, {flag: true, n: 60}], null, false]);
    const joined = await adapter.aggregate({collection: 'items', pipeline: 'SELECT a.id, b.id, 3 AS "2024" FROM items a JOIN items b ON b.id = a.id + 1 ORDER BY a.id', skip: 10, limit: 2});
    assert.deepStrictEqual([joined.columns, joined.items, joined.more], [['id', 'id (2)', '2024'], [{'id': 11, 'id (2)': 12, '2024': 3}, {'id': 12, 'id (2)': 13, '2024': 3}], true]);
    const all = await adapter.aggregate({collection: 'Order Lines', pipeline: '', skip: 0, limit: 50});
    assert.deepStrictEqual(all.items.length, 2);

    // What is wrong is PostgreSQL's words, and the page's
    await assert.rejects(adapter.documents({collection: 'items', filter: 'nam = 1', sort: '', fields: '', skip: 0, limit: 50}), {status: 400, message: /^column "nam" does not exist/});
    await assert.rejects(adapter.documents({collection: 'nothing', filter: '', sort: '', fields: '', skip: 0, limit: 50}), {status: 400, message: `no table called nothing in ${DATABASE}`});
    await assert.rejects(adapter.documents({collection: 'locked.secrets', filter: '', sort: '', fields: '', skip: 0, limit: 50}), {status: 400, message: 'permission denied for schema locked'});
    await assert.rejects(adapter.aggregate({collection: 'items', pipeline: 'SELEC 1', skip: 0, limit: 50}), {status: 400, message: /^syntax error at or near "SELEC"/});

    // A syntax error is said of what was typed: in it, PostgreSQL's words, a token cut at its end;
    // past it, at the end of the condition, the ORDER BY, the columns or the query, never the
    // statement around it
    const syntax = [
        [{filter: 'name = = \'a\''}, 'syntax error at or near "="'],
        [{filter: 'name = \'abc'}, 'unterminated quoted string at or near "\'abc"'],
        [{filter: 'name ='}, 'syntax error at the end of the condition'],
        [{filter: 'id IN (1, 2'}, 'syntax error at the end of the condition'],
        [{filter: 'id > 1', sort: 'id DESC,'}, 'syntax error at the end of the ORDER BY'],
        [{fields: 'id,'}, 'syntax error at the end of the columns'],
        [{pipeline: 'SELECT * FROM items WHERE'}, 'syntax error at the end of the query'],
        [{pipeline: 'SELECT * FROM items WHERE id = = 1'}, 'syntax error at or near "="'],
    ];
    for (const [typed, said] of syntax) {
        const door = (typed.pipeline === undefined) ? 'documents' : 'aggregate';
        const ask = Object.assign((door === 'documents') ? {collection: 'items', filter: '', sort: '', fields: ''} : {collection: 'items'}, {skip: 0, limit: 50}, typed);
        await assert.rejects(adapter[door](ask), {status: 400, message: said}, JSON.stringify(typed));
    }

    // Nothing is written: a DELETE, a DROP, a COMMIT, a sequence moved, typed into a condition
    // or the query box, are refused by PostgreSQL itself, the transaction being READ ONLY
    const refused = [
        ['documents', 'id = 1; DELETE FROM items', /^syntax error at or near ";"/],
        ['documents', 'true) ; DROP TABLE items; SELECT * FROM items WHERE (true', /^only what one SELECT gives is read here, a row being changed by its own buttons: cannot open multi-query plan as cursor$/],
        ['documents', 'id = nextval(\'items_seq\')', /^it writes, and what is typed here is only read, a row being changed by its own buttons: cannot execute nextval\(\) in a read-only transaction$/],
        ['aggregate', 'DELETE FROM items RETURNING *', /^it writes, and what is typed here is only read, a row being changed by its own buttons: cannot execute DELETE in a read-only transaction$/],
        ['aggregate', 'DELETE FROM items', /^only what one SELECT gives is read here, a row being changed by its own buttons: cannot open DELETE query as cursor$/],
        ['aggregate', 'DROP TABLE items', /^only what one SELECT gives is read here, a row being changed by its own buttons: cannot open DROP TABLE query as cursor$/],
        ['aggregate', 'WITH gone AS (DELETE FROM items RETURNING *) SELECT count(*) FROM gone', /^it writes, and what is typed here is only read, a row being changed by its own buttons: cannot execute/],
        ['aggregate', 'COMMIT', /cannot open COMMIT query as cursor$/],
        ['aggregate', 'SET transaction_read_only = off', /cannot open SET query as cursor$/],
    ];
    for (const [door, text, said] of refused) {
        const ask = (door === 'documents') ? {collection: 'items', filter: text, sort: '', fields: '', skip: 0, limit: 50} : {collection: 'items', pipeline: text, skip: 0, limit: 50};
        await assert.rejects(adapter[door](ask), {status: 400, message: said}, text);
    }
    await assert.rejects(adapter.aggregate({collection: 'items', pipeline: 'SELECT nextval(\'items_seq\')', skip: 0, limit: 50}), {status: 400, message: 'it writes, and what is typed here is only read, a row being changed by its own buttons: cannot execute nextval() in a read-only transaction'});
    assert.strictEqual((await adapter.collections()).find(v => v.name === 'items').count, 121, 'as many as before');
});

// Rows changed by their table's key, in a database of their own: each change in a transaction of
// its own, committed; what is typed reaching PostgreSQL as JSON, each value read by its column's
// type; an edit saving the columns changed alone, and not over another hand's change; every
// refusal in PostgreSQL's words
test('a real PostgreSQL: a row added, edited by its key, deleted, and each refusal in its words', {skip: (CONTAINER === undefined) && 'DATA_BROWSER_POSTGRES names no container'}, async function () {
    const sql_text_of = (await import('../ui/sql_text_of.js')).default;
    psql('postgres', 'postgres', process.env.DATA_BROWSER_POSTGRES_ROOT, [
        `DROP DATABASE IF EXISTS ${CHANGED} WITH (FORCE);`,
        `DROP ROLE IF EXISTS ${CHANGED};`,
        `CREATE ROLE ${CHANGED} WITH LOGIN PASSWORD 'pw';`,
        `CREATE DATABASE ${CHANGED} OWNER ${CHANGED};`,
    ].join('\n'));
    psql(CHANGED, CHANGED, 'pw', [
        'CREATE TABLE customers (email text NOT NULL UNIQUE, name text NOT NULL);',
        'CREATE TABLE orders (id serial PRIMARY KEY, customer text NOT NULL REFERENCES customers (email), status text NOT NULL DEFAULT \'new\' CHECK (status IN (\'new\', \'paid\', \'shipped\')), total numeric(10,2) NOT NULL DEFAULT 0 CHECK (total >= 0), note text);',
        'CREATE TABLE lines (order_id int NOT NULL REFERENCES orders (id) DEFERRABLE INITIALLY DEFERRED, line_no int NOT NULL, qty int NOT NULL, PRIMARY KEY (order_id, line_no));',
        'CREATE TABLE kinds (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, born date, at timestamptz, price numeric(12,2), big bigint, ratio float8, small real, flag boolean, doc jsonb, raw json, tags text[], blob bytea, uid uuid, span interval, doubled numeric GENERATED ALWAYS AS (price * 2) STORED);',
        'CREATE TABLE events (at timestamptz, kind text);',
        'CREATE TABLE visits (path text UNIQUE, n int);',
        'CREATE VIEW paid AS SELECT id, total FROM orders WHERE status = \'paid\';',
        'CREATE SCHEMA archive;',
        'CREATE TABLE archive."Old Orders" ("Order No" int PRIMARY KEY, total numeric(10,2));',
        'INSERT INTO customers VALUES (\'ann@example.com\', \'Ann\'), (\'bob@example.com\', \'Bob\');',
        'INSERT INTO orders (customer, total) VALUES (\'ann@example.com\', 10), (\'bob@example.com\', 20);',
        'INSERT INTO lines VALUES (1, 1, 2), (1, 2, 5);',
        'INSERT INTO kinds (born, at, price, big, ratio, small, flag, doc, raw, tags, blob, uid, span) VALUES (\'2026-01-02\', \'2026-06-01 10:00:00.123456+00\', 2.50, 9007199254740993, 0.1, 1.1, true, \'{"n": 1, "big": 12345678901234567890}\', \'{"raw":  1}\', ARRAY[\'a\', \'b c\'], \'\\x00ff\', \'c81e728d-9d4c-2f63-6f06-7f89cc14862c\', \'90 minutes\');',
        'INSERT INTO kinds DEFAULT VALUES;',
        'INSERT INTO archive."Old Orders" VALUES (7, 1.50);',
    ].join('\n'));
    const adapter = postgresql_adapter(v => psql(CHANGED, CHANGED, 'pw', v));
    // A row read whole by its key, as Edit shows it: the text an edit starts from
    async function row_text_read(collection, id) {
        const found = await adapter.document({collection, id});
        return sql_text_of(new Map(found.columns.map(v => [v, found.item[v]])), true);
    }

    // The key a row is named by: the primary key, else a unique key of NOT NULL columns; none
    // for a unique key of a column that may be NULL, and none for a view
    const keys = (await adapter.collections()).map(v => `${v.name} ${JSON.stringify(v.key)}`);
    assert.deepStrictEqual(keys, ['customers ["email"]', 'events null', 'kinds ["id"]', 'lines ["order_id","line_no"]', 'orders ["id"]', 'paid null', 'visits null', 'archive.Old Orders ["Order No"]']);
    assert.deepStrictEqual(await adapter.document({collection: 'orders', id: null}), {item: null, columns: ['id', 'customer', 'status', 'total', 'note'], key: ['id'], filled: ['id', 'status', 'total']});

    // + Row: the columns given, read by their types, defaults filling the rest, read back
    const added = await adapter.insert({collection: 'orders', document: '{"customer": "bob@example.com", "note": "\'); DROP TABLE orders; --"}'});
    assert.deepStrictEqual(added, {id: {id: 3}, item: {id: 3, customer: 'bob@example.com', status: 'new', total: {$numberDecimal: '0.00'}, note: '\'); DROP TABLE orders; --'}, saved: ['customer', 'note']});
    assert.deepStrictEqual((await adapter.insert({collection: 'kinds', document: '{}'})).id, {id: 3});
    const odd = await adapter.insert({collection: 'archive.Old Orders', document: '{"Order No": 8, "total": 2.25}'});
    assert.deepStrictEqual(odd.id, {'Order No': 8});

    // Every kind of value, written back as the page reads it, saves nothing; each changed saves
    // that column alone, read by its type
    const kinds = await row_text_read('kinds', {id: 1});
    assert.deepStrictEqual((await adapter.replace({collection: 'kinds', id: {id: 1}, document: kinds, was: kinds})).saved, []);
    const edited = kinds.replace('"price": 2.50', '"price": 3.75').replace('"big": 9007199254740993', '"big": 9007199254740999').replace('"tags": ["a", "b c"]', '"tags": ["x"]').replace('"blob": "\\\\x00ff"', '"blob": "\\\\x0a0b"').replace('"flag": true', '"flag": null');
    const saved = await adapter.replace({collection: 'kinds', id: {id: 1}, document: edited, was: kinds});
    assert.deepStrictEqual(saved.saved, ['price', 'big', 'flag', 'tags', 'blob']);
    assert.deepStrictEqual([saved.item.price, saved.item.big, saved.item.flag, saved.item.tags, saved.item.blob, saved.item.doubled, saved.item.ratio, saved.item.small], [3.75, {$numberLong: '9007199254740999'}, null, ['x'], '\\x0a0b', {$numberDecimal: '7.50'}, 0.1, 1.1]);
    const again = await row_text_read('kinds', {id: 1});
    assert.deepStrictEqual((await adapter.replace({collection: 'kinds', id: {id: 1}, document: again, was: again})).saved, [], 'what was saved reads back the same');

    // Another hand's change: to a column this edit changes, said with what it holds now, and
    // nothing saved; to another column, kept, and this edit's saved beside it
    const order = await row_text_read('orders', {id: 1});
    psql(CHANGED, CHANGED, 'pw', 'UPDATE orders SET status = \'shipped\', note = \'by an app\' WHERE id = 1;');
    await assert.rejects(adapter.replace({collection: 'orders', id: {id: 1}, document: order.replace('"status": "new"', '"status": "paid"'), was: order}), {status: 409, message: 'it changed since it was read, by another hand: status is "shipped" now', changed: ['status']});
    const merged = await adapter.replace({collection: 'orders', id: {id: 1}, document: order.replace('"total": 10.00', '"total": 11.50'), was: order});
    assert.deepStrictEqual([merged.saved, merged.item.status, merged.item.note, merged.item.total], [['total'], 'shipped', 'by an app', {$numberDecimal: '11.50'}]);

    // A key changed is the row's new name; a row gone is said so
    const line = await row_text_read('lines', {order_id: 1, line_no: 2});
    const moved = await adapter.replace({collection: 'lines', id: {order_id: 1, line_no: 2}, document: line.replace('"line_no": 2', '"line_no": 9'), was: line});
    assert.deepStrictEqual(moved.id, {order_id: 1, line_no: 9});
    await assert.rejects(adapter.replace({collection: 'lines', id: {order_id: 1, line_no: 2}, document: line, was: line}), {status: 400, message: /^it is not there any more/});

    // Refused, in PostgreSQL's words, nothing written
    const refusals = [
        ['insert', {collection: 'orders', document: '{"customer": null}'}, 400, /^null value in column "customer" of relation "orders" violates not-null constraint: Failing row contains/],
        ['insert', {collection: 'orders', document: '{"customer": "zed@example.com"}'}, 400, /^insert or update on table "orders" violates foreign key constraint "orders_customer_fkey": Key \(customer\)=\(zed@example.com\) is not present in table "customers"\.$/],
        ['insert', {collection: 'orders', document: '{"customer": "ann@example.com", "total": -1}'}, 400, /^new row for relation "orders" violates check constraint "orders_total_check"/],
        ['insert', {collection: 'orders', document: '{"customer": "ann@example.com", "total": "much"}'}, 400, /^invalid input syntax for type numeric: "much"$/],
        ['insert', {collection: 'orders', document: '{"customer": "ann@example.com", "x\\"; DROP TABLE orders; --": 1}'}, 400, /^no column "x"; DROP TABLE orders; --" in orders$/],
        ['insert', {collection: 'kinds', document: '{"doubled": 1}'}, 400, /^cannot insert a non-DEFAULT value into column "doubled"/],
        ['insert', {collection: 'lines', document: '{"order_id": 999, "line_no": 1, "qty": 1}'}, 400, /^insert or update on table "lines" violates foreign key constraint "lines_order_id_fkey"/],
        ['insert', {collection: 'customers', document: '[1]'}, 400, /^the row is a JSON object of its columns/],
        ['insert', {collection: 'customers', document: '{name: 1}'}, 400, /^the row is no JSON/],
        ['insert', {collection: 'events', document: '{"kind": "x"}'}, 405, 'events has no primary key, nor a unique key of NOT NULL columns, to name one row by: its rows are read alone'],
        ['insert', {collection: 'visits', document: '{"n": 1}'}, 405, /^visits has no primary key/],
        ['insert', {collection: 'paid', document: '{}'}, 405, 'paid is a view: its rows are changed in the tables it reads'],
        ['insert', {collection: 'nothing', document: '{}'}, 400, `no table called nothing in ${CHANGED}`],
        ['remove', {collection: 'orders', id: {id: 1}}, 400, /^update or delete on table "orders" violates foreign key constraint "lines_order_id_fkey" on table "lines": Key \(id\)=\(1\) is still referenced from table "lines"\.$/],
        ['remove', {collection: 'lines', id: {order_id: 1}}, 400, 'a row of lines is named by its key: order_id, line_no'],
        ['remove', {collection: 'lines', id: 7}, 400, /^id names the row by its key/],
        ['remove', {collection: 'orders', id: {id: 'one'}}, 400, /^invalid input syntax for type integer: "one"$/],
        ['document', {collection: 'events', id: {at: 1}}, 405, /^events has no primary key/],
    ];
    for (const [method, ask, status, said] of refusals) {
        await assert.rejects(adapter[method](ask), {status, message: said}, `${method} ${JSON.stringify(ask)}`);
    }
    assert.deepStrictEqual((await adapter.collections()).map(v => `${v.name} ${v.count}`).slice(0, 5), ['customers 2', 'events 0', 'kinds 3', 'lines 2', 'orders 3'], 'nothing refused was written');

    // Deleted by its key, answered with what it held; then gone
    assert.deepStrictEqual(await adapter.remove({collection: 'orders', id: {id: 3}}), {id: {id: 3}, item: added.item, saved: []});
    await assert.rejects(adapter.remove({collection: 'orders', id: {id: 3}}), {status: 400, message: /^it is not there any more/});

    // A row another transaction holds is waited for, then said so, nothing changed
    const holder = child_process.spawn(DOCKER, ['exec', '-e', 'PGPASSWORD=pw', CONTAINER, 'psql', '-X', '-q', '-h', '127.0.0.1', '-U', CHANGED, '-d', CHANGED, '-c', 'BEGIN; SELECT id FROM orders WHERE id = 2 FOR UPDATE; SELECT pg_sleep(10); COMMIT;'], {stdio: 'ignore'});
    try {
        await new Promise(v => setTimeout(v, 2000));
        await assert.rejects(adapter.remove({collection: 'orders', id: {id: 2}}), {status: 409, message: /^another transaction holds the row/});
    }
    finally {
        holder.kill();
    }
});

// A syntax error goes through the page's block to psql, which says it with its position in the
// statement, after where each part typed stands: said of the part, never quoting the statement
// around it. Past the condition, the ORDER BY, the columns or the query, it is at their end; in
// one, PostgreSQL's words, a token quoted past its end cut at it; anything else as psql said it.
test('a PostgreSQL syntax error is said of what was typed, never of the statement around it', async function () {
    const scripts = [];
    function adapter_said(parts, error) {
        return postgresql_adapter(function (script) {
            scripts.push(script);
            const said = [`psql:/tmp/serviceman-0a.sql:40: NOTICE:  serviceman-parts ${JSON.stringify(parts)}`, `psql:/tmp/serviceman-0a.sql:52: ERROR:  ${error}`];
            return Promise.reject(Object.assign(new Error(said.join('\n')), {stdout: ''}));
        });
    }
    const find = {collection: 'big', filter: 'status = ', sort: '', fields: '', skip: 0, limit: 50};
    const cases = [
        [[['condition', 34, 43]], 'syntax error at or near ")" at character 44', find],
        [[['condition', 34, 43]], 'syntax error at or near "=" at character 41', Object.assign({}, find, {filter: 'status = = 1'})],
        [[['condition', 34, 47]], 'unterminated quoted string at or near "\'😀 Zoë\n) LIMIT 51 OFFSET 0" at character 41', Object.assign({}, find, {filter: 'name = \'😀 Zoë'})],
        [[['columns', 9, 12], ['condition', 40, 46]], 'syntax error at or near "FROM" at character 14', Object.assign({}, find, {fields: 'id,', filter: 'n = 1'})],
        [[['condition', 34, 39], ['ORDER BY', 52, 58]], 'syntax error at or near "LIMIT" at character 60', Object.assign({}, find, {filter: 'n = 1', sort: 'n DESC,'})],
        [[['query', 1, 24]], 'syntax error at end of input at character 24', {collection: 'big', pipeline: 'SELECT * FROM big WHERE', skip: 0, limit: 50}],
        [[], 'syntax error at or near "FROM" at character 10', find],
    ];
    const said = [];
    for (const [parts, error, ask] of cases) {
        const adapter = adapter_said(parts, error);
        said.push(await adapter[(ask.pipeline === undefined) ? 'documents' : 'aggregate'](ask).catch(e => `${e.status} ${e.message}`));
    }
    assert.deepStrictEqual(said, [
        '400 syntax error at the end of the condition',
        '400 syntax error at or near "="',
        '400 unterminated quoted string at or near "\'😀 Zoë"',
        '400 syntax error at the end of the columns',
        '400 syntax error at the end of the ORDER BY',
        '400 syntax error at the end of the query',
        '400 syntax error at or near "FROM"',
    ]);
    // psql says aside, in few words, whatever the user's own setting; the block lets a syntax error
    // through, and nothing else
    assert.match(scripts[0], /^\\set VERBOSITY terse\nBEGIN TRANSACTION READ ONLY;\nSET LOCAL client_min_messages = notice;/);
    assert.match(scripts[0], /RAISE NOTICE 'serviceman-parts %', parts;\n.*\n {4}OPEN page_cursor/);
    assert.match(scripts[0], /EXCEPTION\n {4}WHEN syntax_error THEN\n {8}RAISE;\n {4}WHEN query_canceled THEN/);
    // A psql that stopped for anything else is said as it said it
    const away = postgresql_adapter(() => Promise.reject(new Error('psql: error: connection to server at "127.0.0.1", port 5432 failed')));
    await assert.rejects(away.documents(find), {message: /^psql: error: connection to server/});
});

// A script run by psql in the container as `user`, over 127.0.0.1, its password in the env:
// copied in as a file, as serviceman puts it there
function psql(database, user, password, script)
{
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'data-browser-')), 'script.sql');
    fs.writeFileSync(file, script);
    const inside = `/tmp/data-browser-${path.basename(path.dirname(file))}.sql`;
    child_process.execFileSync(DOCKER, ['cp', file, `${CONTAINER}:${inside}`]);
    try {
        return child_process.execFileSync(DOCKER, ['exec', '-e', `PGPASSWORD=${password}`, CONTAINER, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', user, '-d', database, '-f', inside], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    }
    catch (error) {
        throw Object.assign(new Error(String(error.stderr).trim()), {stdout: String(error.stdout)});
    }
    finally {
        child_process.execFileSync(DOCKER, ['exec', CONTAINER, 'rm', '-f', inside]);
    }
}
