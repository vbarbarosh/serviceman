const KIB = 1024;

// What dpkg, apt-mark and a dry-run upgrade say -> one row per installed package, by name.
// A package of a second architecture, libc6:i386 beside libc6, is a row of its own.
//
// Status is dpkg's three letters: wanted, state, error. "ii " is installed and well, "hi " the
// same and held; "rc " is removed with its config left behind, which is not installed and is
// left out; any other state or an error letter is a package caught half way, marked so.
function package_list_from_dpkg(status_text, manual_text, hold_text, upgrade_text)
{
    const manual = new Set(lines_of(manual_text));
    const held = new Set(lines_of(hold_text));
    const updates = updates_from_apt(upgrade_text);
    const out = [];
    for (const line of lines_of(status_text)) {
        const columns = line.split('\t');
        if (columns.length < 7) {
            continue;
        }
        const status = columns[0];
        if ((status[1] === 'n') || (status[1] === 'c')) {
            continue;
        }
        const name = columns[1];
        const arch = columns[2];
        const size = parseInt(columns[4], 10);
        out.push({
            name,
            arch,
            version: columns[3],
            size: Number.isFinite(size) ? size*KIB : null,
            section: columns[5],
            summary: columns.slice(6).join('\t'),
            manual: manual.has(name) || manual.has(`${name}:${arch}`),
            held: held.has(name) || held.has(`${name}:${arch}`),
            broken: (status[1] !== 'i') || ((status[2] || ' ') !== ' '),
            update: updates[`${name}:${arch}`] || updates[name] || null,
        });
    }
    out.sort((a, b) => (a.name === b.name) ? cmp(a.arch, b.arch) : cmp(a.name, b.name));
    return out;
}

// "Inst libssl3 [3.0.2-0ubuntu1.15] (3.0.2-0ubuntu1.18 Ubuntu:22.04/jammy-security [amd64])"
// -> the version it would become, and whether a security archive is where it comes from
function updates_from_apt(text)
{
    const out = {};
    for (const line of lines_of(text)) {
        const found = /^Inst (\S+?)(?::\S+)? (?:\[\S+\] )?\((\S+) (.*?) \[(\S+)\]\)/.exec(line);
        if (found === null) {
            continue;
        }
        const update = {version: found[2], security: /-security\b/.test(found[3])};
        out[`${found[1]}:${found[4]}`] = update;
        out[found[1]] = update;
    }
    return out;
}

function lines_of(text)
{
    return (text || '').split('\n').map(v => v.trim()).filter(v => v !== '');
}

// Package names are ascii, and the order apt itself lists them in
function cmp(a, b)
{
    return (a < b) ? -1 : ((a > b) ? 1 : 0);
}

module.exports = package_list_from_dpkg;
