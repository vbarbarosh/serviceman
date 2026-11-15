const address_ways = require('./address_ways');
const dns = require('dns');
const tailnet_ip_read = require('./tailnet_ip_read');
const tailnet_name_read = require('./tailnet_name_read');

// A DNS that does not answer in this is no answer: the page waits on the slowest name
const LOOKUP_MS = 3000;
// A name looked up this recently is not asked again: Addresses is opened and opened again
const FRESH_MS = 30000;

// Every address's way (address_ways), with each name looked up as this computer's DNS answers
// it, the way a browser here would find it. app.address_lookups keeps the answers a while.
async function address_ways_read(app)
{
    const facts = {
        tailnet: {name: tailnet_name_read.known(), ip: await tailnet_ip_read()},
        apps: app.config.apps,
        app_ports: ports_of(app),
        services: app.services.map(v => ({name: v.name, hosts: v.hosts})),
        remotes: app.remotes.map(v => ({name: v.name, title: v.title, hosts: Object.keys(v.inbound || {}), addresses: addresses_of(v)})),
        lookups: {},
    };
    const names = address_ways.names(facts);
    // A name no longer in the config is not kept
    for (const name of Array.from(app.address_lookups.keys())) {
        if (names.includes(name) === false) {
            app.address_lookups.delete(name);
        }
    }
    const looked = await Promise.all(names.map(v => lookup_kept(app, v)));
    for (let i = 0; i < names.length; i++) {
        facts.lookups[names[i]] = looked[i];
    }
    return address_ways(facts);
}

function ports_of(app)
{
    const out = {};
    for (const name of Object.keys(app.app_ports_here)) {
        const found = app.app_ports_here[name];
        out[name] = {port: found.port, error: found.error};
    }
    return out;
}

// Where a machine is: the addresses its agent said, its tailnet address among them, and the
// one its link came from unless that is serviceman's own loopback (tailscale hands the tailnet
// in there); null while it has said nothing since serviceman started
function addresses_of(remote)
{
    const resources = remote.state.resources;
    if ((resources === null) || (resources === undefined) || (Array.isArray(resources.addresses) === false)) {
        return null;
    }
    const out = resources.addresses.slice();
    const tailnet = resources.tailnet;
    if ((tailnet !== null) && (typeof tailnet === 'object') && (typeof tailnet.ip === 'string') && (out.includes(tailnet.ip) === false)) {
        out.push(tailnet.ip);
    }
    const from = String(remote.state.address || '').replace(/^::ffff:/, '');
    if ((from !== '') && (from.startsWith('127.') === false) && (from !== '::1') && (out.includes(from) === false)) {
        out.push(from);
    }
    return out;
}

// {addresses, error}: what this computer's DNS says of a name, kept for FRESH_MS
async function lookup_kept(app, name)
{
    const kept = app.address_lookups.get(name);
    if ((kept !== undefined) && (Date.now() - kept.at < FRESH_MS)) {
        return kept.said;
    }
    const said = await lookup(name);
    app.address_lookups.set(name, {at: Date.now(), said});
    return said;
}

function lookup(name)
{
    let timer = null;
    const late = new Promise(function (resolve) {
        timer = setTimeout(resolve, LOOKUP_MS, {addresses: [], error: `no answer in ${LOOKUP_MS/1000} s`});
    });
    const asked = dns.promises.lookup(name, {all: true}).then(function (found) {
        return {addresses: found.map(v => v.address), error: null};
    }, function (error) {
        return {addresses: [], error: error.code || error.message};
    });
    return Promise.race([asked, late]).finally(function () {
        clearTimeout(timer);
    });
}

module.exports = address_ways_read;
