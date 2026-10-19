const agent_dir = require('./agent_dir');
const agent_say = require('./agent_say');
const agent_servermon_dir = require('./agent_servermon_dir');
const agent_servermon_text = require('./agent_servermon_text');
const child_process = require('child_process');
const file_write_synced = require('./file_write_synced');
const fs = require('fs');
const path = require('path');

const CHECK_MS = 60*1000;
// A servermon that has written nothing for this long is stuck, and is started again
const SILENT_MS = 30*1000;

// servermon, the machine's load every second into logs/servermon/, a file a day: written beside
// the agent as servermon.js and kept running by it. Checked when the agent starts and every
// minute: one that is gone, runs an older text or has gone silent is started again. It runs
// detached, so a restart of the agent leaves it running; the agent finds it again by its
// command line, `node <agent folder>/servermon.js`. A machine whose agent keeps no log folder
// has none.
function agent_servermon(status, group)
{
    const dir = agent_servermon_dir();
    if (dir === null) {
        status.servermon = {state: 'off', pid: null, dir: null, error: null};
        return;
    }
    const ctx = {
        file: path.join(agent_dir(), 'servermon.js'),
        dir,
        started_at: 0,
    };
    // Where agent 1.20.0 kept its pid
    fs.rmSync(path.join(agent_dir(), 'servermon.json'), {force: true});
    // Agent 1.21.3 named its stderr servermon.err: a servermon it started goes on writing there
    if (fs.existsSync(path.join(dir, 'servermon.err'))) {
        fs.renameSync(path.join(dir, 'servermon.err'), path.join(dir, 'servermon.stderr'));
    }
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
        const pids = pids_find(ctx.file);
        const reason = restart_reason(ctx, pids);
        if (reason === null) {
            // One is enough: a second one, started by hand, is stopped
            for (const pid of pids.slice(1)) {
                process.kill(pid, 'SIGKILL');
            }
            status.servermon = {state: 'running', pid: pids[0], dir: ctx.dir, error: null};
            return;
        }
        // SIGKILL: servermon has nothing to tidy, and a stuck one may not take a SIGTERM
        for (const pid of pids) {
            process.kill(pid, 'SIGKILL');
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

// Why the one running is not good enough, or null when it is
function restart_reason(ctx, pids)
{
    if ((fs.existsSync(ctx.file) === false) || (fs.readFileSync(ctx.file, 'utf8') !== agent_servermon_text)) {
        return (pids.length === 0) ? 'none' : 'new version';
    }
    if (pids.length === 0) {
        return 'gone';
    }
    if ((Date.now() - Math.max(ctx.started_at, newest_write(ctx.dir))) > SILENT_MS) {
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
    // Its stderr: what it says about itself and how it died, the last start's only
    const err_fd = fs.openSync(path.join(ctx.dir, 'servermon.stderr'), 'w');
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
    if (child.pid === undefined) {
        throw new Error(`${ctx.file} did not start`);
    }
    ctx.started_at = Date.now();
    return child.pid;
}

// The processes running this servermon.js: node with the file as its first argument
function pids_find(file)
{
    const out = [];
    for (const name of fs.readdirSync('/proc').filter(v => /^\d+$/.test(v))) {
        let argv;
        try {
            argv = fs.readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0');
        }
        catch {
            continue;
        }
        if (argv[1] === file) {
            out.push(Number(name));
        }
    }
    return out;
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
