const path = require('path');
const remote_call = require('./remote_call');
const remote_can = require('./remote_can');
const vulnerabilities_feed = require('../../../../modules/vulnerabilities/server/vulnerabilities_feed');
const vulnerabilities_kept = require('./vulnerabilities_kept');
const vulnerabilities_match = require('../../../../modules/vulnerabilities/server/vulnerabilities_match');
const vulnerabilities_notes = require('./vulnerabilities_notes');

const READ_TIMEOUT_MS = 30000;

// The critical CVEs that hit one machine, looked at with the rest of its Security look: what
// it runs, asked of its agent (its release, its kernel, its packages), against Ubuntu's list of
// that release, read here once an hour if it changed. Nothing about the machine leaves
// serviceman. One that cannot be judged says why: an agent from before, a system that is not
// Ubuntu, a list that could not be read.
//
//     out   {at, codename, kernel, list: {generated, checked_at, error} | null, reason, items}
//           items: vulnerabilities_match's, or null where reason says why there are none
async function vulnerabilities_of_remote(app, remote)
{
    const now = Date.now();
    const out = {at: now, codename: null, kernel: null, list: null, reason: null, items: null};
    if (remote_can(remote, 'package_versions') === false) {
        out.reason = 'its agent is from before this check; it updates itself, and is checked again within the hour';
        return out;
    }
    const facts = await remote_call(app, remote, 'package_versions', {}, READ_TIMEOUT_MS);
    const system = facts.os;
    out.kernel = facts.kernel;
    if ((system === null) || (system.id !== 'ubuntu') || (system.codename === null)) {
        out.reason = `only Ubuntu is checked, as Ubuntu's own list says it; this is ${(system === null) ? 'a system with no /etc/os-release' : (system.name || system.id)}`;
        return out;
    }
    out.codename = system.codename;
    if (facts.packages === null) {
        out.reason = 'dpkg\'s status file is not there, so what is installed is not known';
        return out;
    }
    const list = await vulnerabilities_feed({dir: path.join(app.state_dir, 'vulnerabilities'), codename: system.codename, fetch: app.vulnerabilities_fetch, unpack: app.vulnerabilities_unpack});
    out.list = {generated: list.generated, checked_at: list.checked_at, error: list.error};
    if (list.cves === null) {
        out.reason = list.error;
        return out;
    }
    out.items = vulnerabilities_match(list.cves, {kernel: facts.kernel, packages: facts.packages});
    vulnerabilities_kept.found(app, remote.name, out.items, now);
    vulnerabilities_notes.wanted(app, system.codename, out.items.filter(v => v.state === 'no_fix').map(v => v.id));
    return out;
}

module.exports = vulnerabilities_of_remote;
