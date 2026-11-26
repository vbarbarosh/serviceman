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

    // Nothing is written: a DELETE, a DROP, a COMMIT, a sequence moved, typed into a condition
    // or the query box, are refused by PostgreSQL itself, the transaction being READ ONLY
    const refused = [
        ['documents', 'id = 1; DELETE FROM items', /^syntax error at or near ";"/],
        ['documents', 'true) ; DROP TABLE items; SELECT * FROM items WHERE (true', /^only what one SELECT gives is read here, and this page changes nothing for now: cannot open multi-query plan as cursor$/],
        ['documents', 'id = nextval(\'items_seq\')', /^it writes, and this page changes nothing for now: cannot execute nextval\(\) in a read-only transaction$/],
        ['aggregate', 'DELETE FROM items RETURNING *', /^it writes, and this page changes nothing for now: cannot execute DELETE in a read-only transaction$/],
        ['aggregate', 'DELETE FROM items', /^only what one SELECT gives is read here, and this page changes nothing for now: cannot open DELETE query as cursor$/],
        ['aggregate', 'DROP TABLE items', /^only what one SELECT gives is read here, and this page changes nothing for now: cannot open DROP TABLE query as cursor$/],
        ['aggregate', 'WITH gone AS (DELETE FROM items RETURNING *) SELECT count(*) FROM gone', /^it writes, and this page changes nothing for now: cannot execute/],
        ['aggregate', 'COMMIT', /cannot open COMMIT query as cursor$/],
        ['aggregate', 'SET transaction_read_only = off', /cannot open SET query as cursor$/],
    ];
    for (const [door, text, said] of refused) {
        const ask = (door === 'documents') ? {collection: 'items', filter: text, sort: '', fields: '', skip: 0, limit: 50} : {collection: 'items', pipeline: text, skip: 0, limit: 50};
        await assert.rejects(adapter[door](ask), {status: 400, message: said}, text);
    }
    await assert.rejects(adapter.aggregate({collection: 'items', pipeline: 'SELECT nextval(\'items_seq\')', skip: 0, limit: 50}), {status: 400, message: 'it writes, and this page changes nothing for now: cannot execute nextval() in a read-only transaction'});
    assert.strictEqual((await adapter.collections()).find(v => v.name === 'items').count, 121, 'as many as before');
    assert.strictEqual(adapter.insert, undefined, 'its rows are read alone for now');
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
