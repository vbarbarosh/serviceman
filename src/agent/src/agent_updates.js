const agent_apt_binary = require('./agent_apt_binary');
const agent_shell = require('./agent_shell');
const fs = require('fs');

const UPDATES_FILE = '/var/lib/update-notifier/updates-available';
const REBOOT_FILE = '/var/run/reboot-required';

// What ubuntu counted for its own login banner, and — after an upgrade this agent ran — what
// apt says now. The banner file is written once a day, so on its own it would go on saying
// "28 to install" for hours after the 28 were installed. Counting from apt costs a second and
// reads the whole package list, which is why it is done when something changed and not on
// every heartbeat.
let counted = null;
let counted_at = 0;
let wanted = false;

async function agent_updates(options)
{
    if (wanted) {
        wanted = false;
        counted = await counts_from_apt(options);
        counted_at = Date.now();
    }
    const reboot = fs.existsSync(REBOOT_FILE);
    const said = counts_from_file();
    // Whichever of the two knows about the newer state of the machine
    if ((counted !== null) && ((said === null) || (counted_at > file_at()))) {
        return {pending: counted.pending, security: counted.security, reboot};
    }
    if (said === null) {
        return (reboot ? {pending: null, security: null, reboot} : null);
    }
    return {pending: said.pending, security: said.security, reboot};
}

// Ask apt what an upgrade would install now. `-s` changes nothing and needs no root, so this
// is safe to run as whoever the agent is.
async function counts_from_apt(options)
{
    const answer = await agent_shell([agent_apt_binary(options), '-s', 'upgrade']);
    if (answer.ok === false) {
        return null;
    }
    const lines = answer.stdout.split('\n').filter(v => v.startsWith('Inst '));
    return {
        pending: lines.length,
        // apt names the archive a package comes from, and a security archive says so
        security: lines.filter(v => /-security[ /\]]/.test(v)).length,
    };
}

function counts_from_file()
{
    try {
        const text = fs.readFileSync(UPDATES_FILE, 'utf8');
        const out = {pending: 0, security: 0};
        const pending = /(\d+) updates? can be applied/.exec(text);
        if (pending !== null) {
            out.pending = parseInt(pending[1], 10);
        }
        const security = /(\d+)[^\n]*security/.exec(text);
        if (security !== null) {
            out.security = parseInt(security[1], 10);
        }
        return out;
    }
    catch {
        // no update-notifier here
        return null;
    }
}

function file_at()
{
    try {
        return fs.statSync(UPDATES_FILE).mtimeMs;
    }
    catch {
        return 0;
    }
}

// Said by an upgrade that has just ended: what is waiting is not what the file says any more
agent_updates.recount = function () {
    wanted = true;
};

module.exports = agent_updates;
