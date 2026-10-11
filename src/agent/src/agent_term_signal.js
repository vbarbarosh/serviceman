const agent_term_read = require('./agent_term_read');
const fs = require('fs');
const term_name_valid = require('../../helpers/term_name_valid');

// The signals a terminal may be sent by name; anything else is refused
const SIGNALS = ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTERM', 'SIGKILL', 'SIGUSR1', 'SIGUSR2', 'SIGSTOP', 'SIGCONT'];

// Sends `signal` into the terminal `name`: to its shell (`to: 'shell'`, the default), which a
// SIGKILL or SIGHUP ends and the terminal with it, or to whatever runs in it in front
// (`to: 'foreground'`), the process group the terminal's keys would reach — SIGINT there is
// Ctrl-C. With nothing running in front, the foreground is the shell itself.
async function agent_term_signal(params)
{
    if (term_name_valid(params.name) === false) {
        throw new Error(`not a terminal name: ${JSON.stringify(params.name)}`);
    }
    if (SIGNALS.includes(params.signal) === false) {
        throw new Error(`a signal is one of ${SIGNALS.join(', ')}: ${JSON.stringify(params.signal)}`);
    }
    const to = ((params.to === undefined) ? 'shell' : params.to);
    if ((to !== 'shell') && (to !== 'foreground')) {
        throw new Error(`a signal goes to shell or foreground: ${JSON.stringify(params.to)}`);
    }
    const found = agent_term_read(params.name);
    if (found === null) {
        throw new Error(`no terminal named ${params.name} runs on this machine`);
    }
    if (to === 'shell') {
        process.kill(found.shell_pid, params.signal);
        return {name: params.name, signal: params.signal, to, pid: found.shell_pid};
    }
    const group = foreground_group(found.shell_pid);
    process.kill(-group, params.signal);
    return {name: params.name, signal: params.signal, to, pgid: group};
}

// The terminal's foreground process group, as the kernel keeps it for the shell's tty: the
// eighth field of /proc/<pid>/stat, counted after the name in parentheses
function foreground_group(pid)
{
    const text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    return parseInt(fields[5], 10);
}

module.exports = agent_term_signal;
