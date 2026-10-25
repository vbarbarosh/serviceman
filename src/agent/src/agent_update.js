const agent_dir = require('./agent_dir');
const agent_say = require('./agent_say');
const agent_signed = require('../../helpers/agent_signed');
const child_process = require('child_process');
const fs = require('fs');
const path = require('path');

// The last line of logs/update.log, and the code bin/update ended with after it
const UPDATE_END = 'serviceman: bin/update ended with code';
// The first line: which agent process asked for the run
const UPDATE_BEGIN = 'serviceman: bin/update asked by pid';
const TAIL_LINES = 6;

// A run this process started and that has not ended: an ask meanwhile joins it
let running = false;

// The host says this machine is running an older agent than the one it serves. `bin/update` is
// what a person would run here, so that is what runs — it fetches everything again and starts
// the agent afresh, which means this process is about to be replaced. The answer goes back
// first, because after this there is nobody here to answer with.
//
// An agent the installer did not put here — a container above all — has no bin/update. The
// ask carries the new file for exactly that machine: written over this one, the process exits,
// and whatever keeps the agent up starts the new one.
//
// What bin/update prints goes to logs/update.log, with how it ended as the last line. A run
// that ends with this process still here did not replace it: why is said at once, in this
// machine's log and the host's, and again as the answer to the next ask, which runs it anew.
function agent_update(params, group)
{
    const script = path.join(agent_dir(), 'bin', 'update');
    if (fs.existsSync(script)) {
        if (running) {
            return {started: true};
        }
        const log_file = path.join(agent_dir(), 'logs', 'update.log');
        const failed = update_failed(log_file);
        if (failed !== null) {
            fs.rmSync(log_file, {force: true});
            return {started: false, reason: failed};
        }
        fs.mkdirSync(path.dirname(log_file), {recursive: true});
        // A run the agent before this one asked for may still be writing its last lines: they
        // go on into the file it opened, not this one
        fs.rmSync(log_file, {force: true});
        const fd = fs.openSync(log_file, 'w');
        const line = `echo "${UPDATE_BEGIN} ${process.pid}"; sh "$0"; echo "${UPDATE_END} $?"`;
        // systemd gives the agent a PATH of its own, which leaves out a node in ~/.local/bin; the
        // installer bin/update runs looks for node there, so this one is put first
        const env = Object.assign({}, process.env, {PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}`});
        const child = child_process.spawn('/bin/sh', ['-c', line, script], {detached: true, env, stdio: ['ignore', fd, fd]});
        fs.closeSync(fd);
        running = true;
        child.once('exit', function (code) {
            running = false;
            // Ended by a signal: the unit is being stopped for the new agent, which is the run
            // working
            if (code === null) {
                return;
            }
            const reason = update_failed(log_file);
            if (reason !== null) {
                agent_say(group, 'agent_update_failed', {reason});
            }
        });
        child.unref();
        return {started: true};
    }
    if ((params !== undefined) && (typeof params.text === 'string') && (params.text !== '')) {
        const own = path.resolve(process.argv[1]);
        // Only a file the bundler wrote is the agent's to replace. An agent running from the
        // repo has source under it, and source is never overwritten from a link.
        if (fs.readFileSync(own, 'utf8').includes('modules["agent/index"]') === false) {
            return {started: false, reason: `${own} is not a bundled agent — this one runs from the repo and updates with it`};
        }
        // A machine that knows its host's key takes a file that host signed and no other: the
        // link is a token over plain http, and the file runs as this user from now on
        const key = String((process.env.SERVICEMAN_HOST_KEY === undefined) ? '' : process.env.SERVICEMAN_HOST_KEY).trim();
        if ((key !== '') && (agent_signed(params.text, params.signature, key) === false)) {
            return {started: false, reason: 'the file is not signed by the host this machine was installed from — nothing was written'};
        }
        fs.writeFileSync(`${own}.new`, params.text);
        fs.renameSync(`${own}.new`, own);
        // The answer leaves first; then this process steps aside for the file it just wrote
        setTimeout(function () {
            process.exit(0);
        }, 200);
        return {started: true};
    }
    return {started: false, reason: `${script} is not here — this agent was not installed by the installer, and the ask carried no file`};
}

// Why the last run of bin/update left this process standing, or null: it never ran, it is
// still running, or another process asked for it — which is a run that worked: bin/update
// writes its last lines after it started this one
function update_failed(log_file)
{
    let text;
    try {
        if (fs.statSync(log_file).mtimeMs < Date.now() - process.uptime()*1000) {
            return null;
        }
        text = fs.readFileSync(log_file, 'utf8');
    }
    catch {
        return null;
    }
    const all = text.split('\n').map(v => v.trimEnd()).filter(v => v !== '');
    if ((all.length > 0) && all[0].startsWith(UPDATE_BEGIN) && (all[0] !== `${UPDATE_BEGIN} ${process.pid}`)) {
        return null;
    }
    const lines = all.filter(v => v.startsWith(UPDATE_BEGIN) === false);
    const last = lines[lines.length - 1] || '';
    if (last.startsWith(UPDATE_END) === false) {
        return null;
    }
    const code = last.slice(UPDATE_END.length).trim();
    const said = lines.slice(Math.max(0, lines.length - 1 - TAIL_LINES), lines.length - 1).join(' | ');
    if (code === '0') {
        return `bin/update ran to the end, and this agent is still the old one${(said === '') ? '' : ` — it said: ${said}`}`;
    }
    return `bin/update failed with code ${code}${(said === '') ? '' : `: ${said}`}`;
}

module.exports = agent_update;
