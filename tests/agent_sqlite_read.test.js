const agent_sqlite_read = require('../src/agent/src/agent_sqlite_read');
const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const node_sqlite_refusal_of = require('../src/helpers/node_sqlite_refusal_of');
const os = require('os');
const path = require('path');
const test = require('node:test');
const timers = require('timers/promises');

// Why this Node cannot run the reader, false when it can
const SKIPPED = node_sqlite_refusal_of(process.version) || false;
// A statement that never ends by itself: the numbers counted one by one, for ever
const ENDLESS = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c';
// A lock on a file, held while a write is not committed, as an app that writes holds it
const HOLDER = `
const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync(process.argv[1]);
db.exec('BEGIN EXCLUSIVE; INSERT INTO t VALUES (2);');
console.log('locked');
setTimeout(() => db.close(), 60000);
`;

test('node:sqlite is whole from Node 22.16 and 23.11, and in every Node from 24', function () {
    const said = ['v20.11.0', 'v22.12.0', 'v22.15.1', 'v22.16.0', 'v23.4.0', 'v23.11.0', 'v24.0.0', 'v26.13.1', 'what'].map(v => [v, node_sqlite_refusal_of(v) === null]);
    assert.deepStrictEqual(said, [['v20.11.0', false], ['v22.12.0', false], ['v22.15.1', false], ['v22.16.0', true], ['v23.4.0', false], ['v23.11.0', true], ['v24.0.0', true], ['v26.13.1', true], ['what', false]]);
    assert.strictEqual(node_sqlite_refusal_of('v20.11.0'), 'Node v20.11.0 has no node:sqlite whole, which SQLite files are read with: Node 22.16 and later have it');
});

// What a SQLite file holds comes back as JSON with every integer whole, by its digits: the
// reader runs in a process of its own, which opens the file read only
test('a file\'s rows come as JSON, each kind of value as it is, a page with one row past it', {skip: SKIPPED}, async function (t) {
    const dir = dir_make(t);
    const file = shop_make(dir);
    const read = await agent_sqlite_read({path: file, ms: 30000, steps: [
        {sql: 'SELECT * FROM kinds ORDER BY id', ms: 5000},
        {sql: 'SELECT id, name FROM kinds ORDER BY id', skip: 1, limit: 2, ms: 5000},
        {sql: 'SELECT id, note FROM kinds WHERE id < ? ORDER BY id', params: [3], bytes: 30, ms: 5000},
        {sql: 'SELECT a.id, b.id FROM kinds AS a JOIN kinds AS b ON b.id = a.id LIMIT 1', ms: 5000},
    ]});
    assert.strictEqual(read.error, undefined, read.error);
    const [all, page, cut, joined] = read.answers;
    assert.deepStrictEqual(all.names, ['id', 'name', 'big', 'real', 'blob', 'note']);
    assert.strictEqual(all.rows, [
        '[[1,"Ann O\'Neil",9007199254740993,1.5,"0x00ff","says \\"hi\\"\\nand more"]',
        '[2,null,-9223372036854775808,"Infinity","0x",null]',
        '[3,"x",42,-0.1,null,"2026-01-15 10:00:00"]]',
    ].join(','));
    assert.deepStrictEqual([page.rows, page.more, cut.rows, cut.more, cut.cut], ['[[2,null],[3,"x"]]', false, '[[1,"says \\"hi\\"\\nand more"]]', true, true]);
    assert.deepStrictEqual(joined.names, ['id', 'id']);
});

// A write is refused by SQLite itself, and what is no query is not run at all: neither a
// statement that gives no rows nor a second one after the first
test('nothing is written: a write, what gives no rows and a second statement are refused, and the next step runs', {skip: SKIPPED}, async function (t) {
    const dir = dir_make(t);
    const file = shop_make(dir);
    const before = fs.readFileSync(file);
    const read = await agent_sqlite_read({path: file, ms: 30000, steps: [
        {sql: 'DELETE FROM kinds RETURNING id', ms: 5000},
        {sql: 'DELETE FROM kinds', ms: 5000},
        {sql: `VACUUM INTO '${path.join(dir, 'copy.db')}'`, ms: 5000},
        {sql: 'SELECT 1; DELETE FROM kinds', ms: 5000},
        {sql: 'SELECT 1; -- a comment\n;', ms: 5000},
        {sql: 'SELECT nope FROM kinds', ms: 5000},
        {sql: 'SELECT COUNT(*) FROM kinds', ms: 5000},
    ]});
    assert.deepStrictEqual(read.answers.map(v => (v.error === undefined) ? v.rows : `${v.code}: ${v.error}`), [
        '8: attempt to write a readonly database',
        'no_rows: it gives no rows',
        'no_rows: it gives no rows',
        'statements: it is more than one statement',
        '[[1]]',
        '1: no such column: nope',
        '[[3]]',
    ]);
    assert.ok(fs.readFileSync(file).equals(before), 'the file is as it was');
    assert.strictEqual(fs.existsSync(path.join(dir, 'copy.db')), false);
});

test('a file that is gone, a folder, a file that is no SQLite and one locked say so', {skip: SKIPPED}, async function (t) {
    const dir = dir_make(t);
    const file = shop_make(dir);
    const steps = [{sql: 'SELECT 1', ms: 5000}];
    fs.writeFileSync(path.join(dir, 'notes.db'), 'These are notes, not a database.\n'.repeat(100));
    const said = [];
    for (const asked of [path.join(dir, 'gone.db'), dir, path.join(dir, 'notes.db')]) {
        said.push(await agent_sqlite_read({path: asked, ms: 10000, steps}));
    }
    assert.deepStrictEqual(said, [
        {error: `there is no file at ${path.join(dir, 'gone.db')}`, code: 'ENOENT'},
        {error: `${dir} is a folder: a SQLite database is a file`, code: 'EISDIR'},
        {error: 'file is not a database', code: 26},
    ]);
    // Another program writes it, and holds it locked meanwhile: SQLite waits a moment, then
    // says it is busy
    const holder = child_process.spawn(process.execPath, ['-e', HOLDER, file], {stdio: ['ignore', 'pipe', 'ignore']});
    t.after(() => holder.kill('SIGKILL'));
    await new Promise(v => holder.stdout.once('data', v));
    const time0 = Date.now();
    assert.deepStrictEqual(await agent_sqlite_read({path: file, ms: 10000, steps}), {error: 'database is locked', code: 5});
    assert.ok(Date.now() - time0 < 5000);
    assert.deepStrictEqual(await agent_sqlite_read({path: file, ms: 0, steps}), {error: 'ms is the time the ask may take, up to 120000 ms', code: 'ask'});
    assert.deepStrictEqual(await agent_sqlite_read({path: file, ms: 1000, steps: [{sql: 'SELECT 1', ms: 1000, params: [{}]}]}), {error: 'a step\'s params are strings and numbers', code: 'ask'});
});

// A statement holds the thread it runs in until it ends, and nothing but killing its process
// stops it: the agent's own loop goes on meanwhile, ticking as it would, and the reader is
// killed at the step's time, the steps after it not run
test('a statement past its time is stopped, and the agent\'s loop is free while it runs', {skip: SKIPPED}, async function (t) {
    const dir = dir_make(t);
    const file = shop_make(dir);
    let ticks = 0;
    const clock = setInterval(() => ticks++, 50);
    const time0 = Date.now();
    const read = await agent_sqlite_read({path: file, ms: 30000, steps: [
        {sql: 'SELECT COUNT(*) FROM kinds', ms: 5000},
        {sql: ENDLESS, ms: 1500},
        {sql: 'SELECT 2', ms: 5000},
    ]});
    clearInterval(clock);
    const took = Date.now() - time0;
    assert.deepStrictEqual(read.answers.map(v => (v.error === undefined) ? v.rows : `${v.code} ${v.ms}: ${v.error}`), ['[[3]]', 'timeout 1500: it took longer than 1.5 s, and the agent stopped it']);
    assert.ok((took >= 1500) && (took < 4000), `${took} ms`);
    assert.ok(ticks >= 20, `the loop ticked ${ticks} times in ${took} ms`);
    // The whole ask has a time of its own too
    const whole = await agent_sqlite_read({path: file, ms: 1000, steps: [{sql: ENDLESS, ms: 60000}]});
    assert.deepStrictEqual(whole.answers, [{error: 'it took longer than 1 s, and the agent stopped it', code: 'timeout', ms: 1000}]);
});

// The reader is the agent's alone: an agent killed, as a restart kills it, takes its reader with
// it, however long its statement would go on
test('the reader ends with the agent that started it', {skip: SKIPPED}, async function (t) {
    const dir = dir_make(t);
    const file = shop_make(dir);
    const agent = child_process.spawn(process.execPath, ['-e', `require(${JSON.stringify(require.resolve('../src/agent/src/agent_sqlite_read'))})({path: ${JSON.stringify(file)}, ms: 60000, steps: [{sql: ${JSON.stringify(ENDLESS)}, ms: 60000}]});`], {stdio: 'ignore'});
    t.after(() => agent.kill('SIGKILL'));
    let reader = null;
    for (let waited = 0; (reader === null) && (waited < 5000); waited += 100) {
        await timers.setTimeout(100);
        reader = child_process.execFileSync('ps', ['-o', 'pid=', '--ppid', String(agent.pid)], {encoding: 'utf8'}).trim().split('\n').find(v => v.trim() !== '') || null;
    }
    assert.notStrictEqual(reader, null, 'the reader started');
    agent.kill('SIGKILL');
    let state = 'R';
    for (let waited = 0; (state !== null) && (waited < 5000); waited += 100) {
        await timers.setTimeout(100);
        state = process_state_of(Number(reader));
    }
    assert.strictEqual(state, null, `the reader is gone, not in state ${state}`);
});

// An answer the agent does not read any more, its end of the pipe gone first, fails to be written:
// the reader is killed then too, rather than ending as a process ends, which waits for the thread
// of its statement to stop, for good when the statement never ends
test('a reader whose answers nobody reads ends, its statement with it', {skip: SKIPPED}, async function (t) {
    const dir = dir_make(t);
    const file = shop_make(dir);
    const reader = child_process.spawn(process.execPath, [path.join(__dirname, '..', 'src', 'agent', 'index.js'), '--sqlite-read'], {stdio: ['pipe', 'pipe', 'ignore']});
    t.after(() => reader.kill('SIGKILL'));
    reader.stdout.destroy();
    reader.stdin.write(`${JSON.stringify({file, ms: 60000, steps: [{sql: 'SELECT 1', ms: 5000}, {sql: ENDLESS, ms: 60000}]})}\n`);
    const ended = await Promise.race([new Promise(v => reader.once('exit', (code, signal) => v(signal))), timers.setTimeout(5000, 'running')]);
    assert.strictEqual(ended, 'SIGKILL');
});

// A process's state as Linux says it (R, S, D…); null for one that ended, its exit taken by
// whoever reaps it or not yet (Z)
function process_state_of(pid)
{
    let text;
    try {
        text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    }
    catch {
        return null;
    }
    const state = text.slice(text.lastIndexOf(')') + 2, text.lastIndexOf(')') + 3);
    return (state === 'Z') ? null : state;
}

function dir_make(t)
{
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sqlite-'));
    t.after(() => fs.rmSync(out, {recursive: true, force: true}));
    return out;
}

// A file with each kind of value SQLite keeps: an integer past 2^53, the least 64-bit one, a
// real, one past what a double holds, a blob and an empty one, text with quotes and a new line,
// a date as text, null
function shop_make(dir)
{
    const {DatabaseSync} = require('node:sqlite');
    const out = path.join(dir, 'shop.db');
    const db = new DatabaseSync(out);
    db.exec('CREATE TABLE kinds (id INTEGER PRIMARY KEY, name TEXT, big INTEGER, real REAL, blob BLOB, note TEXT); CREATE TABLE t (id INTEGER);');
    const insert = db.prepare('INSERT INTO kinds VALUES (?, ?, ?, ?, ?, ?)');
    insert.run(1, 'Ann O\'Neil', 9007199254740993n, 1.5, Buffer.from([0, 255]), 'says "hi"\nand more');
    insert.run(2, null, -9223372036854775808n, 1e999, Buffer.alloc(0), null);
    insert.run(3, 'x', 42, -0.1, null, '2026-01-15 10:00:00');
    db.close();
    return out;
}
