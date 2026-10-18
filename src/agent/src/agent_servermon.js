const agent_dir = require('./agent_dir');
const agent_say = require('./agent_say');
const agent_servermon_text = require('./agent_servermon_text');
const child_process = require('child_process');
const crypto = require('crypto');
const file_write_synced = require('./file_write_synced');
const fs = require('fs');
const path = require('path');
const proc_start_time = require('./proc_start_time');

const CHECK_MS = 60*1000;
// A servermon that has written nothing for this long is stuck, and is started again
const SILENT_MS = 30*1000;

// servermon, the machine's load every second into logs/servermon/, a file a day: written beside
// the agent as servermon.js and kept running by it. Checked when the agent starts and every
// minute: one that is gone, runs an older text or has gone silent is started again. It runs
// detached, written down in servermon.json, pid and start time: a restart of the agent leaves
// it running and takes it back. A machine whose agent keeps no log folder has none.
function agent_servermon(status, group)
{
    const log_dir = process.env.SERVICEMAN_LOG_DIR || '';
    if ((log_dir === '') || (log_dir === 'none')) {
        status.servermon = {state: 'off', pid: null, dir: null, error: null};
        return;
    }
    const ctx = {
        file: path.join(agent_dir(), 'servermon.js'),
        record_file: path.join(agent_dir(), 'servermon.json'),
        dir: path.join(path.resolve(log_dir), 'servermon'),
        hash: crypto.createHash('sha256').update(agent_servermon_text).digest('hex').slice(0, 16),
    };
    status.servermon = {state: 'starting', pid: null, dir: ctx.dir, error: null};
    check(ctx, status, group);
    // The clock never keeps the agent up by itself: --once ends with its link
    const clock = setInterval(function () {
        check(ctx, status, group);
    }, CHECK_MS);
    clock.unref();
}

function check(ctx, status, group)
{
    try {
        const record = record_read(ctx.record_file);
        const alive = ((record !== null) && (proc_start_time(record.pid) === record.started));
        const reason = restart_reason(ctx, record, alive);
        if (reason === null) {
            status.servermon = {state: 'running', pid: record.pid, dir: ctx.dir, error: null};
            return;
        }
        // SIGKILL: servermon has nothing to tidy, and a stuck one may not take a SIGTERM
        if (alive) {
            process.kill(record.pid, 'SIGKILL');
        }
        const pid = start(ctx);
        status.servermon = {state: 'running', pid, dir: ctx.dir, error: null};
        agent_say(group, 'servermon_begin', {pid, reason, dir: ctx.dir});
    }
    catch (error) {
        status.servermon = {state: 'failed', pid: null, dir: ctx.dir, error: error.message};
        agent_say(group, 'servermon_begin_error', {reason: error.message, then: 'tried again in a minute'});
    }
}

// Why the one written down is not good enough, or null when it is
function restart_reason(ctx, record, alive)
{
    if (record === null) {
        return 'none';
    }
    if (alive === false) {
        return 'gone';
    }
    if (record.hash !== ctx.hash) {
        return 'new version';
    }
    if ((Date.now() - Math.max(record.at, newest_write(ctx.dir))) > SILENT_MS) {
        return 'silent';
    }
    return null;
}

function start(ctx)
{
    if ((fs.existsSync(ctx.file) === false) || (fs.readFileSync(ctx.file, 'utf8') !== agent_servermon_text)) {
        file_write_synced(ctx.file, agent_servermon_text, 0o755);
    }
    fs.mkdirSync(ctx.dir, {recursive: true});
    // What it says about itself and how it died, the last start's only
    const err_fd = fs.openSync(path.join(ctx.dir, 'servermon.err'), 'w');
    let child;
    try {
        child = child_process.spawn(process.execPath, [ctx.file], {
            cwd: path.dirname(ctx.file),
            env: Object.assign({}, process.env, {DIR: ctx.dir}),
            detached: true,
            stdio: ['ignore', 'ignore', err_fd],
        });
    }
    finally {
        fs.closeSync(err_fd);
    }
    child.unref();
    const started = ((child.pid === undefined) ? null : proc_start_time(child.pid));
    if (started === null) {
        throw new Error(`${ctx.file} did not start`);
    }
    file_write_synced(ctx.record_file, JSON.stringify({pid: child.pid, started, hash: ctx.hash, at: Date.now()}));
    return child.pid;
}

function record_read(file)
{
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}

// When servermon last wrote a line: the newest of its day files, 0 for none
function newest_write(dir)
{
    if (fs.existsSync(dir) === false) {
        return 0;
    }
    let newest = 0;
    for (const name of fs.readdirSync(dir).filter(v => /^\d{8}\.jsonl$/.test(v))) {
        newest = Math.max(newest, fs.statSync(path.join(dir, name)).mtimeMs);
    }
    return newest;
}

module.exports = agent_servermon;
