const node_sqlite_refusal_of = require('../../helpers/node_sqlite_refusal_of');
const worker_threads = require('worker_threads');

// How long a statement waits for a file another program holds locked while it writes, before
// SQLite says it is busy
const BUSY_MS = 2000;
// What is left after a statement's text once its comments, its semicolons and its spaces go:
// anything else is a second statement
const RE_COMMENTS = /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;
const RE_EMPTY = /[\s;]/g;

// The thread of the reader of a SQLite file (agent_sqlite_child) that reads it, with Node's own
// node:sqlite: the file opened read only, and its writes refused besides by query_only, then the
// statements of the ask run one after another, each said back to the reader's thread as it ends.
// What it says, each a message:
//
//     {began: i}                                          step i begins
//     {step: i, names, rows, more, cut, took_ms}          what it found
//     {step: i, error, code}                              what SQLite refused, its result code
//     {error, code}                                       the file not read at all
//
// rows is JSON text, an array of rows, each an array of values: an integer as its digits, whole
// however long; a real as JSON writes it, Infinity as text; text; a blob as 0x and its hex; null.
// A statement must give rows, and be one alone: what gives none (a DELETE, an ATTACH, a VACUUM
// INTO) is refused before it runs, and so is a second statement after the first.
//
//     ask = {file, steps: [{sql, params, skip, limit, bytes}]}
//
//     node <agent> --sqlite-read, in a thread of its own given the ask as its workerData
function agent_sqlite_worker()
{
    const ask = worker_threads.workerData;
    const port = worker_threads.parentPort;
    const sqlite = sqlite_required();
    if (sqlite === null) {
        const refusal = node_sqlite_refusal_of(process.version);
        port.postMessage({error: (refusal === null) ? `the node:sqlite of Node ${process.version} here lacks what a file is read with: a statement's iterate, columns and setReturnArrays` : refusal, code: 'node'});
        return;
    }
    let db;
    try {
        db = new sqlite.DatabaseSync(ask.file, {readOnly: true, timeout: BUSY_MS});
        db.exec('PRAGMA query_only = ON');
        // The file's first read: one that is no SQLite, or is locked, says so here, for the
        // whole of it
        db.prepare('SELECT COUNT(*) FROM sqlite_schema').get();
    }
    catch (error) {
        port.postMessage(refusal_of(error));
        return;
    }
    for (let i = 0, end = ask.steps.length; i < end; ++i) {
        port.postMessage({began: i});
        port.postMessage(Object.assign({step: i}, step_run(db, ask.steps[i])));
    }
    db.close();
}

// node:sqlite, with all a file is read with; null on a Node that has none, or not all of it
function sqlite_required()
{
    let out;
    try {
        out = require('node:sqlite');
    }
    catch {
        return null;
    }
    const statement = out.StatementSync.prototype;
    if ((typeof statement.iterate !== 'function') || (typeof statement.columns !== 'function') || (typeof statement.setReturnArrays !== 'function')) {
        return null;
    }
    return out;
}

// One statement run: its rows from `skip` on, `limit` of them and one more, which says whether
// more are there; `bytes` of them at most, the first row whatever its size
function step_run(db, step)
{
    const time0 = Date.now();
    const skip = (step.skip === undefined) ? 0 : step.skip;
    const limit = (step.limit === undefined) ? Infinity : step.limit;
    const bytes_most = (step.bytes === undefined) ? Infinity : step.bytes;
    let statement;
    try {
        statement = db.prepare(step.sql);
    }
    catch (error) {
        return refusal_of(error);
    }
    if (rest_of(step.sql, statement) !== '') {
        return {error: 'it is more than one statement', code: 'statements'};
    }
    const names = statement.columns().map(v => v.name);
    if (names.length === 0) {
        return {error: 'it gives no rows', code: 'no_rows'};
    }
    statement.setReadBigInts(true);
    statement.setReturnArrays(true);
    const rows = [];
    let bytes = 0;
    let passed = 0;
    let more = false;
    let cut = false;
    try {
        for (const row of statement.iterate(...((step.params === undefined) ? [] : step.params))) {
            if (passed < skip) {
                passed++;
                continue;
            }
            if (rows.length >= limit) {
                more = true;
                break;
            }
            const text = row_json_of(row);
            if (((bytes + text.length) > bytes_most) && (rows.length > 0)) {
                more = true;
                cut = true;
                break;
            }
            bytes += text.length;
            rows.push(text);
        }
    }
    catch (error) {
        return refusal_of(error);
    }
    return {names, rows: `[${rows.join(',')}]`, more, cut, took_ms: Date.now() - time0};
}

// What is left of a statement's text after the one SQLite read of it, its comments and spaces
// gone: '' for a statement alone
function rest_of(text, statement)
{
    const source = (typeof statement.sourceSQL === 'function') ? statement.sourceSQL() : statement.sourceSQL;
    const at = (typeof source === 'string') ? text.indexOf(source) : -1;
    if (at < 0) {
        return '';
    }
    return text.slice(at + source.length).replace(RE_COMMENTS, '').replace(RE_EMPTY, '');
}

function row_json_of(row)
{
    return `[${row.map(value_json_of).join(',')}]`;
}

// A value as JSON text: an integer as its digits, which JSON.parse would round past 2^53 and the
// data browser reads whole (ejson_from_json)
function value_json_of(value)
{
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
    }
    if (typeof value === 'string') {
        return JSON.stringify(value);
    }
    return JSON.stringify(`0x${Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('hex')}`);
}

// What SQLite refused: its words, and its result code where node:sqlite says it
function refusal_of(error)
{
    return {error: error.message, code: (typeof error.errcode === 'number') ? error.errcode : 'sqlite'};
}

module.exports = agent_sqlite_worker;
