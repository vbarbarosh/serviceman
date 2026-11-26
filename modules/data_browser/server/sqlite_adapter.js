const ejson_from_json = require('./ejson_from_json');
const items_from_rows = require('./items_from_rows');
const sql_part_from_text = require('./sql_part_from_text');

// How long a page of rows may take to be found, and to be counted, before the reader is stopped
const FIND_MS = 20000;
const COUNT_MS = 5000;
// What one ask may take in all: its steps one after another
const ASK_MS = 30000;
// A table is counted row by row up to this size, all of them within COUNT_MS; past either, the
// rows SQLite's statistics say it holds (sqlite_stat1, kept by ANALYZE) are said, as an estimate
const COUNT_BYTES = 64*1024*1024;
// What a page of rows carries at most: the rest of the page is left out, and it says so
const PAGE_BYTES = 4*1024*1024;
// SQLite's result codes the page says in its own words, each the primary code, the low byte of
// an extended one
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_READONLY = 8;
const SQLITE_CORRUPT = 11;
const SQLITE_CANTOPEN = 14;
const SQLITE_NOTADB = 26;
// What the reader says of the file itself, before SQLite reads it: the status each is answered
// with, its words the reader's own
const STATUS_BY_CODE = {ENOENT: 404, EISDIR: 400, EACCES: 403, node: 501, readers: 503, reader: 502, ask: 502, large: 400};

// The file's tables and views, SQLite's own (sqlite_*) left out, by name
const TABLES = [
    'SELECT name, type, sql',
    'FROM sqlite_schema',
    'WHERE type IN (\'table\', \'view\') AND name NOT LIKE \'sqlite\\_%\' ESCAPE \'\\\'',
    'ORDER BY LOWER(name), name',
].join('\n');
// Its indexes, each with the table it is of
const INDEXES = 'SELECT name, tbl_name FROM sqlite_schema WHERE type = \'index\'';
// The rows ANALYZE counted, which a file without sqlite_stat1 does not have: the first number of
// each line of a table's
const STATS = 'SELECT tbl, stat FROM sqlite_stat1';
// The bytes of each table and index, its pages: dbstat, which Node's SQLite has
const SIZES = 'SELECT name, SUM(pgsize) FROM dbstat GROUP BY name';
// A table a module makes, as its statement says
const RE_VIRTUAL = /^\s*CREATE\s+VIRTUAL\b/i;

// SQLite, for the data browser: a file of a machine, which that machine's agent reads itself with
// node:sqlite (agent_sqlite_read). `run(ask)` sends it the statements of one ask, {ms, steps:
// [{sql, params, skip, limit, bytes, ms}]}, and answers with what each found, {answers}, or why
// the file was not read, {error, code}. The file is opened read only and its writes refused
// besides: a DELETE typed into a condition or the query box is refused by SQLite itself; one that
// gives no rows (an ATTACH, a VACUUM INTO) is not run at all, nor a second statement after the
// first. What is typed is run as typed, by SQLite, with the file's data alone. Its rows are not
// changed here, as a database's are: the file is its app's own data, written by its app, and
// writing into it under the app is another question (read_only says so, for the change doors).
//
//     adapter = sqlite_adapter(v => remote_call(app, remote, 'sqlite_read', {path, ...v}))
//     await adapter.file()          // {size, mtime_ms}: the file, opened as SQLite, for its head
//     await adapter.collections()   // [{name, type, count, estimated, bytes, storage_bytes, index_bytes, indexes}]
//     await adapter.documents({collection: 'orders', filter: "status = 'paid'", sort: 'placed DESC', fields: 'id, total', skip: 0, limit: 50})
//                                   // {items, columns, count, more, took_ms, cut}
//     await adapter.aggregate({collection: 'orders', pipeline: 'SELECT status, COUNT(*) FROM orders GROUP BY status', skip: 0, limit: 50})
//                                   // {items, columns, count: null, more, took_ms, cut}
function sqlite_adapter(run)
{
    return {
        engine: 'sqlite',
        read_only: 'a SQLite file is its app\'s own data: it is read here alone, never written under its app',
        // The file as the page heads it, read as SQLite and nothing more: one that is gone, a
        // folder or no SQLite is refused here, before any table is asked of it
        file: async function () {
            const answer = await run({ms: COUNT_MS, steps: []});
            answers_read(answer);
            return {size: answer.size, mtime_ms: answer.mtime_ms};
        },
        collections: async function () {
            const answers = answers_read(await run({ms: ASK_MS, steps: [
                {sql: TABLES, ms: FIND_MS},
                {sql: INDEXES, ms: FIND_MS},
                {sql: STATS, ms: COUNT_MS},
                {sql: SIZES, ms: COUNT_MS},
            ]}));
            const tables = rows_read(answers[0]);
            const indexes = rows_or_none(answers[1]);
            const estimates = estimates_of(rows_or_none(answers[2]));
            const sizes = sizes_of(answers[3]);
            const virtuals = virtual_names_of(tables);
            const items = tables.map(v => item_of(v, indexes, sizes));
            // Each table small enough, or of a size not known, counted
            await counts_read(run, items.filter(v => (v.type === 'table') && ((v.bytes === null) || (v.bytes <= COUNT_BYTES)) && (virtuals.includes(v.name) === false)));
            for (const item of items) {
                if ((item.type === 'table') && (item.count === null) && (estimates[item.name] !== undefined)) {
                    item.count = estimates[item.name];
                    item.estimated = true;
                }
            }
            return items;
        },
        documents: async function (ask) {
            const target = name_quoted(ask.collection);
            const fields = sql_part_from_text(ask.fields, '');
            const filter = sql_part_from_text(ask.filter, 'WHERE');
            const sort = sql_part_from_text(ask.sort, 'ORDER BY');
            const where = (filter === '') ? '' : ` WHERE (\n${filter}\n)`;
            const order = (sort === '') ? '' : ` ORDER BY\n${sort}\n`;
            const statement = `SELECT ${(fields === '') ? '*' : `\n${fields}\n`} FROM ${target}${where}${order} LIMIT ? OFFSET ?`;
            const answers = answers_read(await run({ms: ASK_MS, steps: [
                {sql: statement, params: [ask.limit + 1, ask.skip], limit: ask.limit, bytes: PAGE_BYTES, ms: FIND_MS},
                {sql: `SELECT COUNT(*) FROM ${target}${where}`, ms: COUNT_MS},
            ]}));
            const page = page_read(answers[0]);
            const counted = answers[1];
            page.count = ((counted === undefined) || (counted.error !== undefined)) ? null : number_of(rows_read(counted)[0][0]);
            return page;
        },
        aggregate: async function (ask) {
            const query = sql_part_from_text(ask.pipeline, '');
            const statement = (query === '') ? `SELECT * FROM ${name_quoted(ask.collection)}` : query;
            const answers = answers_read(await run({ms: ASK_MS, steps: [{sql: statement, skip: ask.skip, limit: ask.limit, bytes: PAGE_BYTES, ms: FIND_MS}]}));
            return page_read(answers[0]);
        },
    };
}

// The rows of the tables given counted, all of them within COUNT_MS: an ask of their own, after
// the list. A count stopped, or refused, leaves the table's as it was.
async function counts_read(run, counted)
{
    if (counted.length === 0) {
        return;
    }
    const answer = await run({ms: COUNT_MS, steps: counted.map(v => ({sql: `SELECT COUNT(*) FROM ${name_quoted(v.name)}`, ms: COUNT_MS}))});
    if (answer.error !== undefined) {
        return;
    }
    for (let i = 0, end = counted.length; i < end; ++i) {
        const one = answer.answers[i];
        if ((one !== undefined) && (one.error === undefined)) {
            counted[i].count = number_of(rows_read(one)[0][0]);
        }
    }
}

// One table or view of the list: its size its pages', a view's none; its indexes counted
function item_of(row, indexes, sizes)
{
    const [name, type] = row;
    const out = {name, type: (type === 'view') ? 'view' : 'table', count: null, estimated: false, bytes: null, storage_bytes: null, index_bytes: null, indexes: null};
    if (out.type === 'view') {
        return out;
    }
    const own = indexes.filter(v => v[1] === name).map(v => v[0]);
    out.indexes = own.length;
    if ((sizes !== null) && (sizes[name] !== undefined)) {
        out.bytes = number_of(sizes[name]);
        out.index_bytes = own.reduce((sum, v) => sum + ((sizes[v] === undefined) ? 0 : number_of(sizes[v])), 0);
        out.storage_bytes = out.bytes + out.index_bytes;
    }
    return out;
}

// The tables of a module's (FTS5, R*Tree), whose rows are its to make: not counted, and their
// size is that of the tables the module keeps them in
function virtual_names_of(tables)
{
    return tables.filter(v => RE_VIRTUAL.test(v[2] || '')).map(v => v[0]);
}

// The bytes of each table and index by its name; null where dbstat did not answer
function sizes_of(answer)
{
    return ((answer === undefined) || (answer.error !== undefined)) ? null : Object.fromEntries(rows_read(answer));
}

// The rows ANALYZE counted of each table: the first number of its lines, the most of them
function estimates_of(rows)
{
    const out = {};
    for (const [table, stat] of rows) {
        const found = /^\d+/.exec(String(stat));
        if (found !== null) {
            out[table] = Math.max(out[table] || 0, Number(found[0]));
        }
    }
    return out;
}

// The answers of an ask that ran; one that did not, the file not read at all, is thrown, with
// the status of what stopped it
function answers_read(answer)
{
    if (answer.error !== undefined) {
        throw Object.assign(new Error(said_of(answer)), {status: status_of(answer)});
    }
    return answer.answers;
}

// A step's rows, as values; its refusal thrown
function rows_read(answer)
{
    if (answer === undefined) {
        throw Object.assign(new Error('the reader stopped before it was read'), {status: 502});
    }
    if (answer.error !== undefined) {
        throw Object.assign(new Error(said_of(answer)), {status: status_of(answer)});
    }
    return ejson_from_json(answer.rows);
}

// A step's rows, or none for one refused: what the file may not have
function rows_or_none(answer)
{
    return ((answer === undefined) || (answer.error !== undefined)) ? [] : rows_read(answer);
}

// A page as the browser answers it: its rows as objects keyed by column, the columns in order;
// count null, as a query's is
function page_read(answer)
{
    const rows = items_from_rows(answer.names || [], rows_read(answer));
    return {items: rows.items, columns: rows.columns, count: null, more: answer.more, took_ms: answer.took_ms, cut: answer.cut};
}

// A number of SQLite's, as ejson_from_json gave it: an integer past 2^53 kept whole is a count no
// file has, read as near as a number goes
function number_of(value)
{
    return (typeof value === 'number') ? value : Number(value.$numberLong || value.$numberDecimal);
}

// A name as SQLite quotes it
function name_quoted(name)
{
    return `"${String(name).replace(/"/g, '""')}"`;
}

// What stopped a step or the reader, in words for the page
function said_of(answer)
{
    if (answer.code === 'timeout') {
        return `it took longer than ${answer.ms/1000} s, and the agent stopped it: an index on what it filters or sorts by makes it quick`;
    }
    if (answer.code === 'no_rows') {
        return 'only what one SELECT gives is read here, and an app\'s file is read alone: that statement gives no rows';
    }
    if (answer.code === 'statements') {
        return 'only one statement at a time is read here, and this is more than one: none of it was run';
    }
    if (typeof answer.code !== 'number') {
        return answer.error;
    }
    const code = answer.code & 0xff;
    if (code === SQLITE_READONLY) {
        return `it writes, and an app's file is read alone here: ${answer.error}`;
    }
    if ((code === SQLITE_BUSY) || (code === SQLITE_LOCKED)) {
        return `another program holds the file locked while it writes to it: read it again in a moment (${answer.error})`;
    }
    if (code === SQLITE_NOTADB) {
        return `this file is no SQLite database: ${answer.error}`;
    }
    if (code === SQLITE_CORRUPT) {
        return `the file is damaged: ${answer.error}`;
    }
    if (code === SQLITE_CANTOPEN) {
        return `SQLite could not open it: ${answer.error}`;
    }
    return answer.error;
}

// The status a refusal is answered with: a query that is wrong 400, a file locked 409, and the
// reader's own as it says
function status_of(answer)
{
    if (typeof answer.code === 'number') {
        const code = answer.code & 0xff;
        return ((code === SQLITE_BUSY) || (code === SQLITE_LOCKED)) ? 409 : 400;
    }
    return (STATUS_BY_CODE[answer.code] === undefined) ? 400 : STATUS_BY_CODE[answer.code];
}

module.exports = sqlite_adapter;
