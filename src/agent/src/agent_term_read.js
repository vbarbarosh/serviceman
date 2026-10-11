const agent_terms_dir = require('./agent_terms_dir');
const fs = require('fs');
const path = require('path');

// The note of the terminal `name`, or null when no holder is running it. A holder that died
// without tidying up (the machine rebooted) leaves its files, and its pid may be someone
// else's by now: only a process whose command line names this terminal's files counts.
function agent_term_read(name)
{
    const base = path.join(agent_terms_dir(), name);
    let note;
    try {
        note = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
    }
    catch {
        return null;
    }
    let cmdline;
    try {
        cmdline = fs.readFileSync(`/proc/${note.pid}/cmdline`, 'utf8');
    }
    catch {
        return null;
    }
    if ((cmdline.split('\0').includes(base) === false) || (fs.existsSync(`${base}.sock`) === false)) {
        return null;
    }
    return Object.assign({name, base}, note);
}

module.exports = agent_term_read;
