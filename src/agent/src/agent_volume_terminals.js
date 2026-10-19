const agent_term_read = require('./agent_term_read');
const agent_terms_dir = require('./agent_terms_dir');
const fs = require('fs');

// A process may be at most this deep under its terminal's holder
const DEPTH_MAX = 64;

// A volume's users told by terminal: a process under a terminal's holder is that terminal's, so
// a refusal or the state names the terminal, not only a pid. `terminal` is null for the rest, a
// container's process among them. The value is an answer of the root half: a volume, the list,
// or a refusal with its users.
//
//     holders = {<holder pid>: <terminal name>}, read from the terminals kept here when not given
function agent_volume_terminals(value, holders, proc = '/proc')
{
    if ((value === null) || (typeof value !== 'object')) {
        return value;
    }
    const known = (holders === undefined) ? holders_read() : holders;
    const lists = [value].concat(Array.isArray(value.items) ? value.items : []).filter(v => Array.isArray(v.users));
    for (const list of lists) {
        list.users = list.users.map(v => Object.assign({}, v, {terminal: terminal_of(v.pid, known, proc)}));
    }
    return value;
}

function holders_read()
{
    const out = {};
    let files = [];
    try {
        files = fs.readdirSync(agent_terms_dir());
    }
    catch {
        return out;
    }
    for (const file of files.filter(v => v.endsWith('.json'))) {
        const found = agent_term_read(file.slice(0, -'.json'.length));
        if (found !== null) {
            out[found.pid] = found.name;
        }
    }
    return out;
}

function terminal_of(pid, holders, proc)
{
    let now = pid;
    for (let i = 0; (i < DEPTH_MAX) && (now > 1); ++i) {
        if (holders[now] !== undefined) {
            return holders[now];
        }
        now = parent_of(now, proc);
    }
    return null;
}

// /proc/<pid>/stat: 1234 (bash) S 1200 …: the parent is the second field after the command,
// which may hold spaces and parentheses itself
function parent_of(pid, proc)
{
    try {
        const text = fs.readFileSync(`${proc}/${pid}/stat`, 'utf8');
        return Number(text.slice(text.lastIndexOf(')') + 2).split(' ')[1]);
    }
    catch {
        return 0;
    }
}

module.exports = agent_volume_terminals;
