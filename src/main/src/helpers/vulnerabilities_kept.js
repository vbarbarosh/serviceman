const fs = require('fs');
const path = require('path');

const FILE = 'vulnerabilities.json';

// What serviceman keeps of the CVEs that hit each machine, in the state folder, so a restart
// does not call old ones new: when each was first found there, and since when a fix for it is
// out; and when the CVEs of each machine were last seen (the problems bar closed on them).
//
//     -> {found: {remote: {cve: {at, fix_at}}}, seen: {remote: at}}, read once and kept in app
function vulnerabilities_kept(app)
{
    if (app.vulnerabilities === undefined) {
        app.vulnerabilities = read(app);
    }
    return app.vulnerabilities;
}

function read(app)
{
    try {
        const value = JSON.parse(fs.readFileSync(path.resolve(app.state_dir, FILE), 'utf8'));
        return {found: value.found || {}, seen: value.seen || {}};
    }
    catch {
        return {found: {}, seen: {}};
    }
}

// Written whole, through a file of its own renamed into place
vulnerabilities_kept.write = function (app) {
    const file = path.resolve(app.state_dir, FILE);
    fs.mkdirSync(app.state_dir, {recursive: true});
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(vulnerabilities_kept(app)));
    fs.renameSync(`${file}.tmp`, file);
};

// One machine's last look: each CVE found keeps when it was first found, and since when its
// fix is out (fix_out, restart), until a look no longer finds it
vulnerabilities_kept.found = function (app, remote, items, now) {
    const kept = vulnerabilities_kept(app);
    const before = kept.found[remote] || {};
    const out = {};
    for (const item of items) {
        const was = before[item.id] || {at: now, fix_at: null};
        const fixable = (item.state === 'fix_out') || (item.state === 'restart');
        out[item.id] = {at: was.at, fix_at: fixable ? (was.fix_at || now) : null};
    }
    kept.found[remote] = out;
    vulnerabilities_kept.write(app);
    return out;
};

// The problems bar closed on a machine's new CVEs: they are not new from now on
vulnerabilities_kept.seen = function (app, remotes, now) {
    const kept = vulnerabilities_kept(app);
    for (const remote of remotes) {
        kept.seen[remote] = now;
    }
    vulnerabilities_kept.write(app);
};

module.exports = vulnerabilities_kept;
