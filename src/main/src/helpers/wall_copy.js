// What makes a wall the one it is, never copied: its secret (its sessions are signed with it),
// its database (its users), and the users it is started with. A copy has its own of each: its
// secret and its database in its own storage, its first user the one given.
const OWN = ['AUTHWALL_SECRET', 'AUTHWALL_DB', 'AUTHWALL_SEED'];

// A wall for another team: a copy of a wall serviceman runs as a docker image, under a new name.
// It runs as the wall it copies does (the image, the port, the machines, the settings in its
// environment: who may sign in and how) and is a wall of its own:
//
//   - its own address: the one made of the wall's name is made of the new name
//     (authwall.localhost is authwall-team-a.localhost), and a setting that names the wall's
//     address (AUTHWALL_PUBLIC_URL, a redirect URL) names the new one; an address given by hand
//     belongs to one service only and does not go over
//   - its own storage: every path it writes is kept again under the new name, nothing shared; a
//     read-only one (a certificate, a file of settings) is shared as it is
//   - none of OWN; the first user given goes in as its seed
//
//     entry   the wall as the config file has it
//     fresh   {name, title, user}   user: {username, password, email} or null
//     domain  where an address falls back to when none is made of its name: localhost
//
// Throws an error with a status when the wall cannot be copied.
function wall_copy(entry, fresh, domain)
{
    if (entry.type !== 'docker') {
        throw failure(400, `${entry.name} is not a docker image serviceman runs, so there is nothing to copy: a wall for another team is added as a service of its own`);
    }
    const label_old = entry.name.replace(/_/g, '-');
    const label_new = fresh.name.replace(/_/g, '-');
    const hosts_old = hosts_of(entry.publish);
    const pairs = [];
    for (const text of hosts_old) {
        const host = text.split('/')[0];
        if (host.startsWith(`${label_old}.`)) {
            pairs.push([host, `${label_new}${host.slice(label_old.length)}`, text]);
        }
    }
    const hosts = (pairs.length === 0) ? [`${label_new}.${domain}`] : pairs.map(v => v[1] + v[2].slice(v[0].length));
    const out = Object.assign({}, entry, {name: fresh.name, title: fresh.title});
    out.publish = Object.assign({}, entry.publish);
    delete out.publish.host;
    delete out.publish.hosts;
    if (hosts.length === 1) {
        out.publish.host = hosts[0];
    }
    else {
        out.publish.hosts = hosts;
    }
    if ((fresh.title === '') || (fresh.title === fresh.name)) {
        delete out.title;
    }
    const env = {};
    for (const key of Object.keys(entry.env || {})) {
        if (OWN.includes(key) === false) {
            env[key] = hosts_swapped(String(entry.env[key]), pairs);
        }
    }
    if (fresh.user !== null) {
        env.AUTHWALL_SEED = JSON.stringify([seed_of(fresh.user)]);
    }
    out.env = env;
    if (typeof entry.redirect === 'string') {
        out.redirect = hosts_swapped(entry.redirect, pairs);
    }
    if (Array.isArray(entry.volumes)) {
        out.volumes = entry.volumes.map(volume_own);
    }
    // A wall in front of the wall is the wall's own business, and so is its own sign-in
    delete out.auth;
    return out;
}

function hosts_of(publish)
{
    if ((publish === undefined) || (publish === null)) {
        return [];
    }
    if (typeof publish.host === 'string') {
        return [publish.host];
    }
    return Array.isArray(publish.hosts) ? publish.hosts.filter(v => typeof v === 'string') : [];
}

// Every whole mention of the wall's address in a value is the new address: a name inside a
// longer one (sso.authwall.localhost) is another name and stays
function hosts_swapped(text, pairs)
{
    let out = text;
    for (const [from, to] of pairs) {
        const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(`(^|[^a-zA-Z0-9.-])${escaped}(?![a-zA-Z0-9.-])`, 'g'), `$1${to}`);
    }
    return out;
}

// A path it writes is a path of its own; a read-only one, and one kept already (which is kept
// under the service's name), stays as it is
function volume_own(volume)
{
    if (typeof volume === 'string') {
        const items = volume.split(':');
        if ((items.length < 2) || (items[0] === '') || (items[2] === 'ro')) {
            return volume;
        }
        return {source: '', target: items[1]};
    }
    if ((volume === null) || (typeof volume !== 'object') || (volume.source === '') || (volume.readonly === true)) {
        return volume;
    }
    return {source: '', target: volume.target};
}

// The first user, as authwall's AUTHWALL_SEED takes one: a username, an email, or both
function seed_of(user)
{
    const out = {};
    if (user.username !== '') {
        out.username = user.username;
    }
    if (user.email !== '') {
        out.emails = user.email;
    }
    out.password = user.password;
    return out;
}

function failure(status, text)
{
    return Object.assign(new Error(text), {status});
}

module.exports = wall_copy;
