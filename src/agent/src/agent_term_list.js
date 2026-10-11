const agent_term_read = require('./agent_term_read');
const agent_terms_dir = require('./agent_terms_dir');
const argv_line = require('../../helpers/argv_line');
const fs = require('fs');

// The terminals kept running on this machine, oldest first. `cwd` is the folder its shell is in;
// `command` joins one by hand: the holder's socket carries the terminal as it is.
async function agent_term_list()
{
    let names;
    try {
        names = fs.readdirSync(agent_terms_dir());
    }
    catch {
        names = [];
    }
    const items = [];
    for (const file of names) {
        if (file.endsWith('.json') === false) {
            continue;
        }
        const found = agent_term_read(file.slice(0, -'.json'.length));
        if (found === null) {
            continue;
        }
        items.push({
            name: found.name,
            created_at: found.created_at,
            attached: found.clients,
            cwd: shell_cwd(found.shell_pid),
            command: argv_line(['socat', '-,raw,echo=0', `UNIX-CONNECT:${found.base}.sock`]),
        });
    }
    items.sort((a, b) => (a.created_at - b.created_at) || a.name.localeCompare(b.name));
    return {items};
}

// The folder the shell is in now: it follows each `cd`, and is null once the shell is gone
function shell_cwd(pid)
{
    try {
        return fs.readlinkSync(`/proc/${pid}/cwd`);
    }
    catch {
        return null;
    }
}

module.exports = agent_term_list;
