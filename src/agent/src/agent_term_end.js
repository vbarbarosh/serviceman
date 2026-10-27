const agent_term_read = require('./agent_term_read');
const fs = require('fs');
const term_name_valid = require('../../helpers/term_name_valid');

// Ends the terminal `name`: its holder hangs the shell up, as closing a terminal window does,
// and goes with it. A name that is not running is already ended.
async function agent_term_end(params)
{
    if (term_name_valid(params.name) === false) {
        throw new Error(`not a terminal name: ${JSON.stringify(params.name)}`);
    }
    const found = agent_term_read(params.name);
    if (found === null) {
        return {ended: false};
    }
    if (process_gone(found.shell_pid)) {
        // A holder from before agent 1.27.3 outlives its shell for as long as anything the shell
        // left in the background holds the terminal, and a hang-up reaches no one: it is ended
        // outright, and its files, which it has no chance to take, go too
        process.kill(found.pid, 'SIGKILL');
        for (const suffix of ['.sock', '.json', '.size']) {
            fs.rmSync(`${found.base}${suffix}`, {force: true});
        }
    }
    else {
        process.kill(found.pid, 'SIGTERM');
    }
    return {ended: true};
}

// True when `pid` has ended: gone, or a zombie its parent has not waited for yet (the third
// field of /proc/<pid>/stat, after the name in parentheses)
function process_gone(pid)
{
    let text;
    try {
        text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    }
    catch {
        return true;
    }
    return (text.slice(text.lastIndexOf(')') + 2, text.lastIndexOf(')') + 3) === 'Z');
}

module.exports = agent_term_end;
