const is_tailnet_address = require('../../../helpers/is_tailnet_address');

// The addresses said in a line before the rest are only counted
const LIST_SHOWN = 2;

// Each name a request arrives on, its whole way: who can open it, how it is found, whether it
// works as far as serviceman can tell, and why not (Addresses says where it is set). Worked out
// from what the caller measured (`lookups`, address_ways_read); nothing here asks the network.
//
//     facts     {tailnet: {name, ip}, apps: {domain, dns, address}, app_ports: {app: {port,
//               error}}, services: [{name, hosts}], remotes: [{name, title, hosts,
//               addresses}], lookups: {name: {addresses, error}}}; a remote's addresses are
//               null while it has not said them
//
// Each way is {who, found, check, why}, by the key of its row on Addresses:
// `service <name> <host>`, `door <remote> <host>`, `port <app>`.
//
//     who      'this computer', 'your tailnet', 'your network', 'anyone', or '' for no one known
//     found    how a browser finds where to send it, in a few words
//     check    'ok', 'bad' where it was measured not to work, 'unsure' where what was measured
//              does not say, 'none' where nothing could be measured (a name pattern)
//     why      what was measured, for a check that is not 'ok'; '' otherwise
function address_ways(facts)
{
    const out = {};
    for (const service of facts.services) {
        for (const host of service.hosts) {
            out[`service ${service.name} ${host}`] = way_to_serviceman(facts, name_of(host));
        }
    }
    for (const remote of facts.remotes) {
        for (const host of remote.hosts) {
            out[`door ${remote.name} ${host}`] = way_to_door(facts, remote, name_of(host));
        }
    }
    for (const app of Object.keys(facts.app_ports)) {
        out[`port ${app}`] = way_to_port(facts, facts.app_ports[app]);
    }
    return out;
}

// The names that have to be looked up for the ways above: every name but the ones that need no
// lookup (.localhost) and the patterns (*.example.com)
address_ways.names = function (facts) {
    const names = new Set();
    for (const item of facts.services.concat(facts.remotes)) {
        for (const host of item.hosts) {
            const name = name_of(host);
            if ((is_localhost(name) === false) && (is_pattern(name) === false)) {
                names.add(name);
            }
        }
    }
    return Array.from(names).sort();
};

// A name serviceman's own door answers: .localhost on this computer by itself, a name under the
// apps domain by serviceman's DNS, any other by its DNS
function way_to_serviceman(facts, name)
{
    if (is_localhost(name)) {
        return {who: 'this computer', found: 'by itself: a .localhost name is always this computer', check: 'ok', why: ''};
    }
    if (is_pattern(name)) {
        return {who: '', found: 'each name under it by its own DNS', check: 'none', why: 'a pattern: nothing to look up'};
    }
    const serviceman = serviceman_address(facts, name);
    const looked = lookup_of(facts, name);
    if (is_apps_name(facts, name)) {
        if (facts.apps.dns === null) {
            return {who: 'your tailnet', found: 'serviceman\'s DNS', check: 'bad', why: 'serviceman answers no DNS for the apps domain: apps.dns is not set'};
        }
        if (looked.addresses.includes(serviceman)) {
            return {who: 'your tailnet', found: `serviceman's DNS: ${serviceman}`, check: 'ok', why: ''};
        }
        return {who: 'your tailnet', found: 'serviceman\'s DNS, where Tailscale\'s DNS sends the domain to it', check: 'unsure', why: said_here(looked)};
    }
    if (looked.addresses.length === 0) {
        return {who: '', found: 'its DNS', check: 'bad', why: said_here(looked)};
    }
    const loopback = looked.addresses.find(is_loopback);
    if (loopback !== undefined) {
        return {who: 'this computer', found: `its DNS: ${loopback}`, check: 'ok', why: ''};
    }
    if ((serviceman !== null) && looked.addresses.includes(serviceman)) {
        return {who: 'your tailnet', found: `its DNS: ${serviceman}, serviceman on the tailnet`, check: 'ok', why: ''};
    }
    const first = looked.addresses[0];
    const where = (serviceman === null) ? 'serviceman has no tailnet address' : `serviceman is at ${serviceman}`;
    return {who: who_of(first), found: `its DNS: ${first}`, check: 'unsure', why: `its DNS says ${list_of(looked.addresses)}; ${where}`};
}

// A name a machine's door answers: found by its DNS, which has to lead to that machine
function way_to_door(facts, remote, name)
{
    const title = remote.title || remote.name;
    if (is_pattern(name)) {
        return {who: '', found: 'each name under it by its own DNS', check: 'none', why: 'a pattern: nothing to look up'};
    }
    const looked = lookup_of(facts, name);
    if (looked.addresses.length === 0) {
        return {who: '', found: 'its DNS', check: 'bad', why: said_here(looked)};
    }
    const mine = (remote.addresses === null) ? [] : looked.addresses.filter(v => remote.addresses.includes(v));
    if (mine.length > 0) {
        return {who: who_of(mine[0]), found: `its DNS: ${mine[0]}, the door of ${title}`, check: 'ok', why: ''};
    }
    const first = looked.addresses[0];
    // A cloud machine's public address is often on no interface of its own (a NAT in front):
    // a name that leads elsewhere is said, not called broken
    const has = (remote.addresses === null) ? `${title} has not said its addresses yet` : `${title} has ${(remote.addresses.length === 0) ? 'no address' : list_of(remote.addresses)}`;
    return {who: who_of(first), found: `its DNS: ${first}`, check: 'unsure', why: `its DNS says ${list_of(looked.addresses)}; ${has}`};
}

// An app's own port on serviceman's tailnet name
function way_to_port(facts, found)
{
    const found_by = 'serviceman\'s tailnet name, the app\'s own port';
    if (found.error !== null) {
        const why = /EADDRINUSE/.test(found.error) ? `another program holds ${found.port}` : `port ${found.port} does not listen: ${found.error}`;
        return {who: 'your tailnet', found: found_by, check: 'bad', why};
    }
    if (facts.tailnet.name === null) {
        return {who: 'your tailnet', found: found_by, check: 'bad', why: 'tailscale gives serviceman no tailnet name'};
    }
    return {who: 'your tailnet', found: `${found_by}: ${facts.tailnet.name}`, check: 'ok', why: ''};
}

// Where serviceman's DNS sends the apps' names, or serviceman on the tailnet for any other
function serviceman_address(facts, name)
{
    if (is_apps_name(facts, name) && (facts.apps.address !== null)) {
        return facts.apps.address;
    }
    return facts.tailnet.ip;
}

function lookup_of(facts, name)
{
    const found = facts.lookups[name];
    return (found === undefined) ? {addresses: [], error: 'not looked up'} : found;
}

// What this computer's DNS said of a name it gave no address for
function said_here(looked)
{
    return ((looked.error === null) || (looked.error === 'ENOTFOUND')) ? 'no DNS answer for it here' : `no DNS answer for it here: ${looked.error}`;
}

// A few addresses said in a line: the IPv4 ones first, as people read them, the rest counted
function list_of(addresses)
{
    const sorted = addresses.filter(v => v.includes('.')).concat(addresses.filter(v => (v.includes('.') === false)));
    const shown = sorted.slice(0, LIST_SHOWN).join(', ');
    return (sorted.length > LIST_SHOWN) ? `${shown} and ${sorted.length - LIST_SHOWN} more` : shown;
}

// Who reaches an address: this computer, the tailnet, the network it is on, or everyone
function who_of(address)
{
    if (is_loopback(address)) {
        return 'this computer';
    }
    if (is_tailnet_address(address)) {
        return 'your tailnet';
    }
    if (is_private(address)) {
        return 'your network';
    }
    return 'anyone';
}

function is_apps_name(facts, name)
{
    return (facts.apps.domain !== null) && name.endsWith(`.${facts.apps.domain}`);
}

function is_localhost(name)
{
    return (name === 'localhost') || name.endsWith('.localhost');
}

function is_pattern(name)
{
    return name.includes('*');
}

function is_loopback(address)
{
    return address.startsWith('127.') || (address === '::1');
}

function is_private(address)
{
    return /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address) || /^f[cd][0-9a-f]{2}:/i.test(address);
}

// The name of a host a path may follow: tools.example.com/pdf is looked up as tools.example.com
function name_of(host)
{
    const mark = host.indexOf('/');
    return ((mark === -1) ? host : host.slice(0, mark)).toLowerCase();
}

module.exports = address_ways;
