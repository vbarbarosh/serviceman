const agent_term_read = require('./agent_term_read');
const fs = require('fs');
const term_name_valid = require('../../helpers/term_name_valid');

// The signals a terminal may be sent by name; anything else is refused. SIGWINCH to the
// foreground is "the window changed": a full-screen program draws itself again.
const SIGNALS = ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTERM', 'SIGKILL', 'SIGUSR1', 'SIGUSR2', 'SIGSTOP', 'SIGCONT', 'SIGWINCH'];
const TARGETS = ['shell', 'foreground', 'session'];

// Sends `signal` into the terminal `name`: to its shell (`to: 'shell'`, the default), which a
// SIGKILL or SIGHUP ends and the terminal with it, or to whatever runs in it in front
// (`to: 'foreground'`), the process group the terminal's keys would reach — SIGINT there is
// Ctrl-C. With nothing running in front, the foreground is the shell itself. `to: 'session'`
// is every process group of the shell's session, the jobs it left in the background too, and
// reaches them when the shell itself is gone.
async function agent_term_signal(params)
{
    if (term_name_valid(params.name) === false) {
        throw new Error(`not a terminal name: ${JSON.stringify(params.name)}`);
    }
    if (SIGNALS.includes(params.signal) === false) {
        throw new Error(`a signal is one of ${SIGNALS.join(', ')}: ${JSON.stringify(params.signal)}`);
    }
    const to = (params.to === undefined) ? 'shell' : params.to;
    if (TARGETS.includes(to) === false) {
        throw new Error(`a signal goes to shell, foreground or session: ${JSON.stringify(params.to)}`);
    }
    const found = agent_term_read(params.name);
    if (found === null) {
        throw new Error(`no terminal named ${params.name} runs on this machine`);
    }
    if (to === 'shell') {
        process.kill(found.shell_pid, params.signal);
        return {name: params.name, signal: params.signal, to, pid: found.shell_pid};
    }
    if (to === 'session') {
        const groups = session_groups(found);
        for (const group of groups) {
            group_kill(group, params.signal);
        }
        return {name: params.name, signal: params.signal, to, pgids: groups};
    }
    const group = foreground_group(found.shell_pid);
    process.kill(-group, params.signal);
    return {name: params.name, signal: params.signal, to, pgid: group};
}

// The terminal's foreground process group, as the kernel keeps it for the shell's tty: the
// eighth field of /proc/<pid>/stat, counted after the name in parentheses
function foreground_group(pid)
{
    return stat_fields(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'))[5];
}

// The process groups of the terminal's session, lowest first: the shell leads it, so its pid
// is the session's id, kept by what the shell left behind after it is gone. The kernel gives
// that pid to no one else while one of them lives; a process under that pid now, not the
// holder's child, means the session has ended and the pid is someone else's.
function session_groups(found)
{
    const shell = stat_read(found.shell_pid);
    if ((shell !== null) && (shell[1] !== found.pid)) {
        return [];
    }
    const groups = new Set();
    for (const entry of fs.readdirSync('/proc')) {
        if ((/^\d+$/.test(entry) === false) || ([process.pid, found.pid].includes(Number(entry)))) {
            continue;
        }
        const fields = stat_read(entry);
        if ((fields !== null) && (fields[3] === found.shell_pid)) {
            groups.add(fields[2]);
        }
    }
    return Array.from(groups).sort((a, b) => a - b);
}

// A group that has ended since it was read is no longer anyone to signal
function group_kill(group, signal)
{
    try {
        process.kill(-group, signal);
    }
    catch (error) {
        if (error.code !== 'ESRCH') {
            throw error;
        }
    }
}

// The numbers after the name in /proc/<pid>/stat: [state, ppid, pgrp, session, tty_nr, tpgid,
// …], the state as text; null for a process that is gone
function stat_read(pid)
{
    try {
        return stat_fields(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
    }
    catch {
        return null;
    }
}

function stat_fields(text)
{
    return text.slice(text.lastIndexOf(')') + 2).trim().split(' ').map((v, i) => (i === 0) ? v : parseInt(v, 10));
}

module.exports = agent_term_signal;
