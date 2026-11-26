const agent_fs_path = require('./agent_fs_path');
const child_process = require('child_process');
const fs = require('fs');
const node_sqlite_refusal_of = require('../../helpers/node_sqlite_refusal_of');
const object_from_line = require('../../helpers/object_from_line');
const os = require('os');
const path = require('path');

// How many files this machine reads at once, each a node process of its own
const READERS_MOST = 8;
// What one ask may be: its steps, a statement's text, and the time a step and the whole of it
// may take
const STEPS_MOST = 10000;
const SQL_MOST = 1024*1024;
const STEP_MS_MOST = 60000;
const ASK_MS_MOST = 120000;
// What a reader may print for one ask: a page carries 4 MB at most, and its rows come as JSON
// within JSON, each quote of theirs escaped. A row alone past it (a blob of 20 MB) stops it.
const PRINTED_MOST = 24*1024*1024;
// What is kept of the reader's stderr, for a reader that ended before it answered
const SAID_MOST = 4096;

// The readers running now
let readers = 0;

// A SQLite file of this machine, read: the statements of `steps`, one after another, by Node's
// own node:sqlite in a node process of its own (agent_sqlite_child), which opens the file read
// only and refuses every write. Run in this process, a statement would hold the agent's loop for
// as long as it runs, and nothing but its end stops it, not even a worker thread's terminate:
// a process is killed. Each step may take its `ms`, and the whole ask `ms`; past it the process
// is killed, and the step that ran out says so. The path is read as the File Manager's are
// (agent_fs_path), `root` keeping it within a token's folders.
//
//     ask = {path, root, ms, steps: [{sql, params, skip, limit, bytes, ms}]}
//     out = {answers, took_ms, size, mtime_ms}, the file's size and time, and an answer for each
//           step that ran, in order (no step: the file opened and read as SQLite, and no more):
//           {names, rows, more, cut, took_ms}, rows JSON text (agent_sqlite_worker), or
//           {error, code}: SQLite's refusal and its result code, or a step stopped, code
//           timeout, with its ms; a step after one stopped has no answer
//     out = {error, code}: the file not read at all; code ENOENT, EISDIR, EACCES, node (this
//           machine's Node has no node:sqlite), readers (too many at once), reader (the reader
//           ended without a word), timeout, or SQLite's own for a file it will not open
async function agent_sqlite_read(ask)
{
    const refusal = node_sqlite_refusal_of(process.version);
    if (refusal !== null) {
        return {error: refusal, code: 'node'};
    }
    const asked = ask_refusal_of(ask);
    if (asked !== null) {
        return {error: asked, code: 'ask'};
    }
    let file;
    try {
        file = agent_fs_path(ask.path, ask.root);
    }
    catch (error) {
        return {error: error.message, code: 'EACCES'};
    }
    const stat = fs.statSync(file, {throwIfNoEntry: false});
    if (stat === undefined) {
        return {error: `there is no file at ${file}`, code: 'ENOENT'};
    }
    if (stat.isDirectory()) {
        return {error: `${file} is a folder: a SQLite database is a file`, code: 'EISDIR'};
    }
    try {
        fs.accessSync(file, fs.constants.R_OK);
    }
    catch {
        return {error: `${os.userInfo().username}, whom the agent runs as, may not read ${file}`, code: 'EACCES'};
    }
    if (readers >= READERS_MOST) {
        return {error: `${READERS_MOST} SQLite files are being read on this machine already: read it again when one of them is done`, code: 'readers'};
    }
    readers++;
    try {
        const out = await reader_run({file, steps: ask.steps, ms: ask.ms});
        if (out.answers !== undefined) {
            out.size = stat.size;
            out.mtime_ms = Math.round(stat.mtimeMs);
        }
        return out;
    }
    finally {
        readers--;
    }
}

// Why an ask is none this agent runs; null when it is one
function ask_refusal_of(ask)
{
    if ((typeof ask.path !== 'string') || (ask.path === '') || ask.path.includes('\0')) {
        return 'path is the path of a file';
    }
    if ((Number.isInteger(ask.ms) === false) || (ask.ms < 1) || (ask.ms > ASK_MS_MOST)) {
        return `ms is the time the ask may take, up to ${ASK_MS_MOST} ms`;
    }
    if ((Array.isArray(ask.steps) === false) || (ask.steps.length > STEPS_MOST)) {
        return `steps is a list of at most ${STEPS_MOST} statements`;
    }
    for (const step of ask.steps) {
        if ((step === null) || (typeof step !== 'object') || (typeof step.sql !== 'string') || (step.sql.length > SQL_MOST)) {
            return `a step's sql is a statement of at most ${SQL_MOST} characters`;
        }
        if ((Number.isInteger(step.ms) === false) || (step.ms < 1) || (step.ms > STEP_MS_MOST)) {
            return `a step's ms is the time it may take, up to ${STEP_MS_MOST} ms`;
        }
        if ((step.params !== undefined) && ((Array.isArray(step.params) === false) || step.params.some(v => (typeof v !== 'string') && (typeof v !== 'number')))) {
            return 'a step\'s params are strings and numbers';
        }
        for (const key of ['skip', 'limit', 'bytes']) {
            if ((step[key] !== undefined) && ((Number.isInteger(step[key]) === false) || (step[key] < 0))) {
                return `a step's ${key} is a whole number`;
            }
        }
    }
    return null;
}

// The reader started, given the ask, heard line by line, and stopped when its time is out
function reader_run(ask)
{
    return new Promise(function (resolve) {
        const time0 = Date.now();
        const child = child_process.spawn(process.execPath, [agent_file(), '--sqlite-read'], {stdio: ['pipe', 'pipe', 'pipe']});
        const answers = [];
        let whole = null;
        let running = null;
        let stopped = false;
        let step_timer = null;
        let printed = 0;
        let pending = '';
        let said = '';
        const ask_timer = setTimeout(function () {
            stop({error: `it took longer than ${ask.ms/1000} s, and the agent stopped it`, code: 'timeout', ms: ask.ms});
        }, ask.ms);
        // The reader killed: what `answer` says is the answer of the step running, or of the
        // next one between two; before the first, the file was not read at all
        function stop(answer) {
            if (stopped) {
                return;
            }
            stopped = true;
            if (running !== null) {
                answers[running] = answer;
            }
            else if (answers.length === 0) {
                whole = {error: answer.error, code: answer.code};
            }
            else if (answers.length < ask.steps.length) {
                answers.push(answer);
            }
            child.kill('SIGKILL');
        }
        function line_take(line) {
            const message = object_from_line(line);
            if (message === null) {
                return;
            }
            if (typeof message.began === 'number') {
                running = message.began;
                clearTimeout(step_timer);
                const ms = ask.steps[running].ms;
                step_timer = setTimeout(function () {
                    stop({error: `it took longer than ${ms/1000} s, and the agent stopped it`, code: 'timeout', ms});
                }, ms);
                return;
            }
            if (typeof message.step === 'number') {
                clearTimeout(step_timer);
                running = null;
                answers[message.step] = answer_of(message);
                return;
            }
            whole = {error: String(message.error), code: message.code};
        }
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', function (chunk) {
            // What a reader stopped said after it is no answer
            if (stopped) {
                return;
            }
            printed += chunk.length;
            if (printed > PRINTED_MOST) {
                stop({error: `its answer is more than ${PRINTED_MOST/1024/1024} MB: a row of it alone is that large, so ask for fewer columns`, code: 'large'});
                return;
            }
            pending += chunk;
            for (let at = pending.indexOf('\n'); at >= 0; at = pending.indexOf('\n')) {
                line_take(pending.slice(0, at));
                pending = pending.slice(at + 1);
            }
        });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', function (chunk) {
            said = (said + chunk).slice(-SAID_MOST);
        });
        // A spawn that fails says so as an event, and unheard it would take the agent down with it
        child.on('error', function (error) {
            whole = {error: `the reader did not start: ${error.message}`, code: 'reader'};
        });
        child.stdin.on('error', function () {});
        child.on('close', function () {
            clearTimeout(ask_timer);
            clearTimeout(step_timer);
            if (whole !== null) {
                resolve(whole);
                return;
            }
            if ((stopped === false) && (answers.length < ask.steps.length)) {
                resolve({error: `the reader ended before it answered: ${last_said(said)}`, code: 'reader'});
                return;
            }
            resolve({answers, took_ms: Date.now() - time0});
        });
        child.stdin.write(`${JSON.stringify(ask)}\n`);
    });
}

// A step's answer as the reader said it, its step number aside
function answer_of(message)
{
    if (message.error !== undefined) {
        return {error: String(message.error), code: message.code};
    }
    return {names: message.names, rows: message.rows, more: message.more, cut: message.cut, took_ms: message.took_ms};
}

// The reader's last words on stderr, its warning that node:sqlite is experimental left out
function last_said(text)
{
    const lines = text.split('\n').map(v => v.trim()).filter(v => (v !== '') && (/ExperimentalWarning|--trace-warnings/.test(v) === false));
    return (lines.length === 0) ? 'it said nothing' : lines[lines.length - 1];
}

// In the agent's one file every module is that file; in the repo this module sits under the
// agent's entry, whichever program asked: module-host, a test
function agent_file()
{
    return (path.basename(__filename) === 'agent_sqlite_read.js') ? path.join(__dirname, '..', 'index.js') : __filename;
}

module.exports = agent_sqlite_read;
