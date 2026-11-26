const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite_adapter = require('../server/sqlite_adapter');
const test = require('node:test');

// The reader serviceman's agent reads a machine's SQLite file with, in a process of its own:
// what this module's host gives the adapter as its run, here run on files the test makes. It
// needs a Node with node:sqlite whole, 22.16 and later.
const AGENT_SQLITE_READ = path.join(__dirname, '..', '..', '..', 'src', 'agent', 'src', 'agent_sqlite_read');
const NODE_SQLITE_REFUSAL_OF = path.join(__dirname, '..', '..', '..', 'src', 'helpers', 'node_sqlite_refusal_of');
const SKIPPED = require(NODE_SQLITE_REFUSAL_OF)(process.version) || false;
// A lock on a file, held while a write is not committed, as an app that writes holds it
const HOLDER = `
const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync(process.argv[1]);
db.exec('BEGIN EXCLUSIVE; INSERT INTO "order lines" VALUES (9, 9, \\'Z\\');');
console.log('locked');
setTimeout(() => db.close(), 60000);
`;

test('a SQLite file: its tables, a page of rows, a condition, an order, the columns, a query, and no write', {skip: SKIPPED}, async function (t) {
    const dir = dir_make(t);
    const file = shop_make(dir);
    const before = fs.readFileSync(file);
    const adapter = adapter_of(file);

    // Its tables and views by name, SQLite's own left out, each with its rows counted, its
    // pages' size and its indexes; a view has no numbers
    const collections = await adapter.collections();
    assert.deepStrictEqual(collections.map(v => `${v.name} ${v.type} ${v.count} ${v.estimated} ${v.indexes}`), ['2024 table 1 false 0', 'customers table 130 false 1', 'empty table 0 false 0', 'order lines table 2 false 0', 'orders table 60 false 0', 'paid view null false null', 'wide table 5 false 0']);
    const customers = collections[1];
    assert.ok((customers.bytes > 0) && (customers.index_bytes > 0) && (customers.storage_bytes === customers.bytes + customers.index_bytes), JSON.stringify(customers));
    assert.deepStrictEqual([collections[5].bytes, collections[5].storage_bytes], [null, null]);

    // A page of rows, each value as SQLite keeps it, an integer past 2^53 whole, a blob as its
    // hex; one past the page says a next one is there, and the condition's rows are counted
    const first = await adapter.documents({collection: 'customers', filter: '', sort: 'id', fields: '', skip: 0, limit: 50});
    assert.deepStrictEqual([first.items.length, first.count, first.more, first.cut], [50, 130, true, false]);
    assert.deepStrictEqual(first.columns, ['id', 'name', 'email', 'joined', 'balance', 'big', 'avatar', 'note']);
    assert.deepStrictEqual(first.items.slice(0, 3), [
        {id: 1, name: 'Ann O\'Neil', email: 'ann@example.com', joined: '2025-06-01 10:00:00', balance: 12.5, big: {$numberLong: '9007199254740993'}, avatar: '0x000102ff', note: 'says "hi"\nand a second line'},
        {id: 2, name: 'Bob', email: null, joined: '2026-01-15', balance: -0.1, big: {$numberLong: '-9223372036854775808'}, avatar: null, note: null},
        {id: 3, name: 'Zoë 東京', email: 'zoe@example.com', joined: '2024-02-29T23:59:59Z', balance: 1e300, big: {$numberLong: '9223372036854775807'}, avatar: '0x', note: 'tab\there'},
    ]);

    // A condition, an order and the columns as typed, the keywords typed by habit dropped
    const found = await adapter.documents({collection: 'customers', filter: 'WHERE id >= 100 AND id % 2 = 0;', sort: 'ORDER BY id DESC', fields: 'id, name', skip: 2, limit: 3});
    assert.deepStrictEqual([found.items, found.count, found.more], [[{id: 126, name: 'customer 126'}, {id: 124, name: 'customer 124'}, {id: 122, name: 'customer 122'}], 16, true]);
    const nulls = await adapter.documents({collection: 'customers', filter: 'email IS NULL', sort: '', fields: '', skip: 0, limit: 50});
    assert.deepStrictEqual([nulls.items.map(v => v.id), nulls.count, nulls.more], [[2], 1, false]);
    const spaced = await adapter.documents({collection: 'order lines', filter: '"line no" > 1', sort: '', fields: '', skip: 0, limit: 50});
    assert.deepStrictEqual(spaced.items, [{'line no': 2, 'qty': 5, 'sku': 'B-2'}]);
    // A view's two columns of one name are named apart by SQLite itself
    const view = await adapter.documents({collection: 'paid', filter: '', sort: '', fields: '', skip: 0, limit: 2});
    assert.deepStrictEqual([view.columns, view.count, view.more], [['id', 'name', 'total', 'id:1'], 20, true]);
    const wide = await adapter.documents({collection: 'wide', filter: '', sort: '', fields: '', skip: 0, limit: 50});
    assert.deepStrictEqual([wide.columns.length, wide.columns[39], wide.items[4].c40], [40, 'c40', 'r5c40']);
    const empty = await adapter.documents({collection: 'empty', filter: '', sort: '', fields: '', skip: 0, limit: 50});
    assert.deepStrictEqual([empty.items, empty.columns, empty.count, empty.more], [[], ['id'], 0, false]);

    // The query box: a query whole, a page of it; a join's two columns of one name both kept,
    // a column named by a number in its place
    const grouped = await adapter.aggregate({collection: 'orders', pipeline: 'SELECT status, COUNT(*) AS n FROM orders GROUP BY status ORDER BY status;', skip: 0, limit: 50});
    assert.deepStrictEqual([grouped.items, grouped.count, grouped.more], [[{status: 'open', n: 40}, {status: 'paid', n: 20}], null, false]);
    const joined = await adapter.aggregate({collection: 'orders', pipeline: 'SELECT o.id, c.id, 3 AS "2024" FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id', skip: 10, limit: 2});
    assert.deepStrictEqual([joined.columns, joined.items, joined.more], [['id', 'id (2)', '2024'], [{'id': 11, 'id (2)': 2, '2024': 3}, {'id': 12, 'id (2)': 3, '2024': 3}], true]);
    const recursive = await adapter.aggregate({collection: 'orders', pipeline: 'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 5) SELECT x FROM n', skip: 0, limit: 50});
    assert.deepStrictEqual(recursive.items.map(v => v.x), [1, 2, 3, 4, 5]);
    const all = await adapter.aggregate({collection: 'order lines', pipeline: '', skip: 0, limit: 50});
    assert.deepStrictEqual(all.items.map(v => v['line no']), [1, 2]);

    // Nothing written: a write typed into the query box or a condition is refused by SQLite
    // itself, what gives no rows is not run, nor a second statement after the first
    const refused = [];
    for (const pipeline of ['DELETE FROM orders', 'DROP TABLE orders', 'SELECT 1; DELETE FROM orders', 'DELETE FROM orders RETURNING id', `ATTACH '${path.join(dir, 'other.db')}' AS other`, `VACUUM INTO '${path.join(dir, 'copy.db')}'`, 'SELEC 1']) {
        refused.push(await adapter.aggregate({collection: 'orders', pipeline, skip: 0, limit: 50}).catch(e => `${e.status} ${e.message}`));
    }
    refused.push(await adapter.documents({collection: 'orders', filter: 'id IN (DELETE FROM orders RETURNING id)', sort: '', fields: '', skip: 0, limit: 50}).catch(e => `${e.status} ${e.message}`));
    refused.push(await adapter.documents({collection: 'orders', filter: 'nope = 1', sort: '', fields: '', skip: 0, limit: 50}).catch(e => `${e.status} ${e.message}`));
    refused.push(await adapter.documents({collection: 'nope', filter: '', sort: '', fields: '', skip: 0, limit: 50}).catch(e => `${e.status} ${e.message}`));
    assert.deepStrictEqual(refused, [
        '400 only what one SELECT gives is read here, and an app\'s file is read alone: that statement gives no rows',
        '400 only what one SELECT gives is read here, and an app\'s file is read alone: that statement gives no rows',
        '400 only one statement at a time is read here, and this is more than one: none of it was run',
        '400 it writes, and an app\'s file is read alone here: attempt to write a readonly database',
        '400 only what one SELECT gives is read here, and an app\'s file is read alone: that statement gives no rows',
        '400 only what one SELECT gives is read here, and an app\'s file is read alone: that statement gives no rows',
        '400 near "SELEC": syntax error',
        '400 near "DELETE": syntax error',
        '400 no such column: nope',
        '400 no such table: nope',
    ]);
    assert.ok(fs.readFileSync(file).equals(before), 'the file is as it was');
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['shop.db']);
});

// A table too big to count at once says the rows ANALYZE counted, as an estimate
test('a table past 64 MB is not counted: its rows are as ANALYZE kept them, or not said', {skip: SKIPPED}, async function (t) {
    const dir = dir_make(t);
    const {DatabaseSync} = require('node:sqlite');
    const file = path.join(dir, 'big.db');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, body BLOB); CREATE TABLE logs (id INTEGER PRIMARY KEY, body BLOB);');
    db.exec('WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 70000) INSERT INTO events SELECT x, zeroblob(1000) FROM n;');
    db.exec('INSERT INTO logs SELECT id, body FROM events;');
    db.exec('ANALYZE events;');
    db.close();
    const collections = await adapter_of(file).collections();
    assert.deepStrictEqual(collections.map(v => `${v.name} ${v.count} ${v.estimated} ${v.bytes > 64*1024*1024}`), ['events 70000 true true', 'logs null false true']);
});

test('a file that is gone, a folder, a file that is no SQLite and one locked are answered with what they are', {skip: SKIPPED}, async function (t) {
    const dir = dir_make(t);
    const file = shop_make(dir);
    fs.writeFileSync(path.join(dir, 'notes.db'), 'These are notes, not a database.\n'.repeat(100));
    const said = [];
    for (const asked of [path.join(dir, 'gone.db'), dir, path.join(dir, 'notes.db')]) {
        said.push(await adapter_of(asked).collections().catch(e => `${e.status} ${e.message}`));
    }
    assert.deepStrictEqual(said, [
        `404 there is no file at ${path.join(dir, 'gone.db')}`,
        `400 ${dir} is a folder: a SQLite database is a file`,
        '400 this file is no SQLite database: file is not a database',
    ]);
    // The head reads the file as SQLite and nothing more: its size and time, or why it is none
    assert.deepStrictEqual(await adapter_of(file).file(), {size: fs.statSync(file).size, mtime_ms: Math.round(fs.statSync(file).mtimeMs)});
    assert.strictEqual(await adapter_of(path.join(dir, 'notes.db')).file().catch(e => `${e.status} ${e.message}`), '400 this file is no SQLite database: file is not a database');
    const holder = child_process.spawn(process.execPath, ['-e', HOLDER, file], {stdio: ['ignore', 'pipe', 'ignore']});
    t.after(() => holder.kill('SIGKILL'));
    await new Promise(v => holder.stdout.once('data', v));
    const locked = await adapter_of(file).documents({collection: 'orders', filter: '', sort: '', fields: '', skip: 0, limit: 50}).catch(e => `${e.status} ${e.message}`);
    assert.strictEqual(locked, '409 another program holds the file locked while it writes to it: read it again in a moment (database is locked)');
});

// What stops a read, said in words and answered with its status, whatever the reader is
test('a statement stopped, a reader too busy and a Node without node:sqlite are said as such', async function () {
    const answers = [
        {answers: [{error: 'it took longer than 20 s, and the agent stopped it', code: 'timeout', ms: 20000}]},
        {error: '8 SQLite files are being read on this machine already: read it again when one of them is done', code: 'readers'},
        {error: 'Node v20.11.0 has no node:sqlite whole, which SQLite files are read with: Node 22.16 and later have it', code: 'node'},
        {error: 'database disk image is malformed', code: 11},
    ];
    const said = [];
    for (const answer of answers) {
        said.push(await sqlite_adapter(() => answer).aggregate({collection: 'a', pipeline: 'SELECT 1', skip: 0, limit: 50}).catch(e => `${e.status} ${e.message}`));
    }
    assert.deepStrictEqual(said, [
        '400 it took longer than 20 s, and the agent stopped it: an index on what it filters or sorts by makes it quick',
        '503 8 SQLite files are being read on this machine already: read it again when one of them is done',
        '501 Node v20.11.0 has no node:sqlite whole, which SQLite files are read with: Node 22.16 and later have it',
        '400 the file is damaged: database disk image is malformed',
    ]);
    // A page whose count was stopped is said without it
    const page = await sqlite_adapter(() => ({answers: [{names: ['n'], rows: '[[1]]', more: false, cut: false, took_ms: 3}, {error: 'it took longer than 5 s, and the agent stopped it', code: 'timeout', ms: 5000}]})).documents({collection: 'a', filter: '', sort: '', fields: '', skip: 0, limit: 50});
    assert.deepStrictEqual(page, {items: [{n: 1}], columns: ['n'], count: null, more: false, took_ms: 3, cut: false});
});

function adapter_of(file)
{
    const agent_sqlite_read = require(AGENT_SQLITE_READ);
    return sqlite_adapter(v => agent_sqlite_read(Object.assign({path: file}, v)));
}

function dir_make(t)
{
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-adapter-'));
    t.after(() => fs.rmSync(out, {recursive: true, force: true}));
    return out;
}

// Every kind of value SQLite keeps, a view, an empty table, 40 columns, a table whose name has a
// space and one named by a number
function shop_make(dir)
{
    const {DatabaseSync} = require('node:sqlite');
    const out = path.join(dir, 'shop.db');
    const db = new DatabaseSync(out);
    db.exec(`
        CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, joined TEXT, balance REAL, big INTEGER, avatar BLOB, note TEXT);
        CREATE INDEX customers_email ON customers (email);
        CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, placed TEXT, total REAL, status TEXT);
        CREATE TABLE "order lines" ("line no" INTEGER, qty INTEGER, sku TEXT);
        CREATE TABLE empty (id INTEGER);
        CREATE TABLE "2024" (n INTEGER);
        INSERT INTO "2024" VALUES (1);
        CREATE VIEW paid AS SELECT o.id, c.name, o.total, c.id FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status = 'paid';
        INSERT INTO "order lines" VALUES (1, 2, 'A-1'), (2, 5, 'B-2');
    `);
    const customer = db.prepare('INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    customer.run(1, 'Ann O\'Neil', 'ann@example.com', '2025-06-01 10:00:00', 12.5, 9007199254740993n, Buffer.from([0, 1, 2, 255]), 'says "hi"\nand a second line');
    customer.run(2, 'Bob', null, '2026-01-15', -0.1, -9223372036854775808n, null, null);
    customer.run(3, 'Zoë 東京', 'zoe@example.com', '2024-02-29T23:59:59Z', 1e300, 9223372036854775807n, Buffer.alloc(0), 'tab\there');
    for (let i = 4; i <= 130; i++) {
        customer.run(i, `customer ${i}`, `c${i}@example.com`, '2026-03-01', i*1.25, i, null, null);
    }
    const order = db.prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?)');
    for (let i = 1; i <= 60; i++) {
        order.run(i, 1 + (i % 10), '2026-03-01', i*3.5, ((i % 3) === 0) ? 'paid' : 'open');
    }
    db.exec(`CREATE TABLE wide (${Array.from({length: 40}, (v, i) => `c${i + 1} TEXT`).join(', ')});`);
    const wide = db.prepare(`INSERT INTO wide VALUES (${Array.from({length: 40}, () => '?').join(', ')})`);
    for (let r = 1; r <= 5; r++) {
        wide.run(...Array.from({length: 40}, (v, i) => `r${r}c${i + 1}`));
    }
    db.close();
    return out;
}
