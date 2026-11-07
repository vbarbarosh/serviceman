const vulnerabilities_view = require('./vulnerabilities_view');

// How many CVEs a problem names before it counts the rest
const NAMED = 3;

// What a machine's critical CVEs make a problem of, as its last Security look found them: ones
// whose fix is out and not in use, until a look finds them mended; and new ones with no fix
// (found since the problems bar was last closed on this machine), until that bar is closed on
// them. A new one whose fix is out is said once, as the fix. One with no fix that was seen
// already is no problem: the Security page keeps it, orange.
//
//     out   [{key, kind, remote, subject, cause, fix, since}]
function problems_of_vulnerabilities(app, remote)
{
    const look = app.security.seen.get(remote.name);
    if ((look === undefined) || (look.vulnerabilities === undefined)) {
        return [];
    }
    const view = vulnerabilities_view(app, remote.name, look.vulnerabilities);
    if (view.items === null) {
        return [];
    }
    const title = remote.title || remote.name;
    const out = [];
    const fresh = view.items.filter(v => v.new && (fixable_of(v) === false));
    if (fresh.length > 0) {
        out.push({
            key: `vulnerability_new:${remote.name}`,
            kind: 'vulnerability',
            remote: remote.name,
            subject: (fresh.length === 1) ? `New critical vulnerability on ${title}: ${fresh[0].id} in ${fresh[0].what}` : `${fresh.length} new critical vulnerabilities on ${title}`,
            cause: `${named(fresh)}: Ubuntu has no fix out for ${(fresh.length === 1) ? 'it' : 'them'} yet${fresh.some(v => v.state === 'pro') ? ', or only in Ubuntu Pro' : ''}.`,
            fix: 'Its Vulnerabilities tab says what each one hits, and Ubuntu\'s stopgap where it gives one; the fix is a problem here once it is out. Closing the problems bar marks them seen.',
            since: Math.max(...fresh.map(v => v.found_at)),
        });
    }
    const fixable = view.items.filter(fixable_of);
    if (fixable.length > 0) {
        const restart_only = fixable.every(v => v.state === 'restart');
        out.push({
            key: `vulnerability_fix:${remote.name}`,
            kind: 'vulnerability',
            remote: remote.name,
            subject: restart_only ? `${title} runs a kernel with a critical vulnerability: the fixed one waits for a restart` : `A fix is out for ${(fixable.length === 1) ? `${fixable[0].id} in ${fixable[0].what}` : `${fixable.length} critical vulnerabilities`} on ${title}`,
            cause: (fixable.length === 1) ? fixable[0].fix : `${named(fixable)}.`,
            fix: restart_only ? 'Restart the machine, when it may: the kernel installed with the fix runs from then on.' : 'Install its updates: Install updates on Remotes, or its Configure tab; a fixed kernel then wants a restart.',
            since: Math.min(...fixable.map(v => v.fix_at || v.found_at)),
        });
    }
    return out;
}

function fixable_of(item)
{
    return (item.state === 'fix_out') || (item.state === 'restart');
}

// A few of them by name, what each hits and its score: CVE-2026-98432 (kernel, 9.2)
function named(items)
{
    const said = items.slice(0, NAMED).map(v => `${v.id} (${v.what}${(v.score === null) ? '' : `, ${v.score}`})`);
    if (items.length > NAMED) {
        return `${said.join(', ')} and ${items.length - NAMED} more`;
    }
    return (said.length === 1) ? said[0] : `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}`;
}

module.exports = problems_of_vulnerabilities;
