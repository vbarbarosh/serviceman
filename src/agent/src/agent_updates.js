const agent_apt_binary = require('./agent_apt_binary');
const agent_apt_lists_at = require('./agent_apt_lists_at');
const agent_shell = require('./agent_shell');
const fs = require('fs');

const UPDATES_FILE = '/var/lib/update-notifier/updates-available';
const REBOOT_FILE = '/var/run/reboot-required';
// What changes when packages are installed, and when apt learns of new ones
const APT_STATE = ['/var/lib/dpkg/status', '/var/lib/apt/lists'];

// What an upgrade would install, as apt counts it: the very upgrade Install runs, so a machine
// just upgraded says 0. Counting reads the whole package list and costs a second, so it is done
// again only when that list or what is installed changed.
//
// Ubuntu's login banner file is no use for it: it counts a full upgrade, with what `upgrade`
// keeps back (phased updates above all), and it is written again at the next login — so it
// said "19 to install" again right after the 19 were installed. It is read only where apt
// cannot be asked.
//
// held: what apt keeps back even so, phased updates Ubuntu hands out a few machines at a time;
// waiting on Ubuntu, not on anyone here, and not counted as to install.
//
// lists_at: when apt last fetched its package lists, which is how old the count is: what was
// published since is in no count until they are fetched again (the root half does it every
// six hours, Install each time).
let counted = null;
let counted_mark = null;
let wanted = false;

async function agent_updates(options)
{
    const mark = apt_mark();
    if (wanted || (mark !== counted_mark)) {
        wanted = false;
        counted_mark = mark;
        counted = await counts_from_apt(options);
    }
    const reboot = fs.existsSync(REBOOT_FILE);
    const lists_at = agent_apt_lists_at('');
    if (counted !== null) {
        return {pending: counted.pending, security: counted.security, held: counted.held, reboot, lists_at};
    }
    const said = counts_from_file();
    if (said === null) {
        return reboot ? {pending: null, security: null, held: null, reboot, lists_at} : null;
    }
    return {pending: said.pending, security: said.security, held: null, reboot, lists_at};
}

// Ask apt what the upgrade Install runs would install now. `-s` changes nothing and needs no
// root, so this is safe to run as whoever the agent is.
async function counts_from_apt(options)
{
    const answer = await agent_shell([agent_apt_binary(options), '-s', 'upgrade', '--with-new-pkgs']);
    if (answer.ok === false) {
        return null;
    }
    const lines = answer.stdout.split('\n').filter(v => v.startsWith('Inst '));
    // "3 upgraded, 1 newly installed, 0 to remove and 2 not upgraded."
    const summary = /(\d+) not upgraded/.exec(answer.stdout);
    return {
        pending: lines.length,
        // apt names the archive a package comes from, and a security archive says so
        security: lines.filter(v => /-security[ /\]]/.test(v)).length,
        held: (summary === null) ? 0 : parseInt(summary[1], 10),
    };
}

// When what is installed, or what apt knows of, last changed: a count from before is stale
function apt_mark()
{
    return APT_STATE.map(function (file) {
        try {
            return fs.statSync(file).mtimeMs;
        }
        catch {
            return 0;
        }
    }).join(' ');
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

// Said by an upgrade that has just ended: count again, whatever the files' times say
agent_updates.recount = function () {
    wanted = true;
};

module.exports = agent_updates;
