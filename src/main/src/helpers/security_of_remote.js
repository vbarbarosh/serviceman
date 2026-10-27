const firewall_serve = require('../../../../modules/firewall/server/firewall_serve');
const path = require('path');
const remote_call = require('./remote_call');
const remote_can = require('./remote_can');
const security_knock = require('./security_knock');

const FACTS_TIMEOUT_MS = 60000;
const PORTS_TIMEOUT_MS = 30000;
const UFW_TIMEOUT_MS = 20000;
// The Firewall tab's own file: the same code says what the firewall does to each port
const FIREWALL_PORTS = path.join(__dirname, '..', '..', '..', '..', 'modules', 'firewall', 'ui', 'firewall_ports.js');
// How many ports are knocked at once, and how many at most on one machine
const KNOCKS_AT_ONCE = 16;
const KNOCKS_MAX = 64;
// What ss prints for a socket on every address
const WILDCARDS = ['*', '0.0.0.0', '::'];

// What the Security page knows of one machine, asked of it now: what its agent reads (ssh, the
// journal, the release, automatic updates, Docker's published ports), the ports it listens on
// with what its firewall does to each, and which of them answer from outside, knocked from here
// at its public addresses. A part that cannot be asked says why, and the rest goes on.
//
//     out   {at, facts, rows, firewall, knocked, errors: {facts, ports, firewall}}
//           rows: the Firewall tab's rows (firewall_ports), each with knock: its answer or null
//           knocked: {addresses, nat, skipped}: where it knocked, or why it did not
async function security_of_remote(app, remote)
{
    const errors = {facts: null, ports: null, firewall: null};
    const [facts, ports, firewall] = await Promise.all([
        facts_read(app, remote).catch(function (error) {
            errors.facts = error.message;
            return null;
        }),
        ports_read(app, remote).catch(function (error) {
            errors.ports = error.message;
            return null;
        }),
        firewall_read(app, remote).catch(function (error) {
            errors.firewall = error.message;
            return null;
        }),
    ]);
    const firewall_ports = (await import(FIREWALL_PORTS)).default;
    const resources = remote.state.resources;
    const addresses = ((resources !== null) && Array.isArray(resources.addresses)) ? resources.addresses : null;
    const rows = (ports === null) ? [] : firewall_ports(items_with_docker(ports.items, facts), addresses, firewall);
    const knocked = knock_where(app, remote, facts, addresses, firewall_ports.ip_kind);
    for (const row of rows) {
        row.knock = null;
    }
    if (knocked.skipped === null) {
        await knock_all(rows.filter(v => knock_wanted(v, knocked)).slice(0, KNOCKS_MAX), knocked);
    }
    return {at: Date.now(), facts, rows, firewall, knocked, errors};
}

async function facts_read(app, remote)
{
    if (remote_can(remote, 'security') === false) {
        throw new Error('its agent is from before the security check; it is asked to update, and is checked again once it has');
    }
    return await remote_call(app, remote, 'security', {}, FACTS_TIMEOUT_MS);
}

async function ports_read(app, remote)
{
    if (remote_can(remote, 'port_list') === false) {
        throw new Error('its agent is from before the port list');
    }
    return await remote_call(app, remote, 'port_list', {}, PORTS_TIMEOUT_MS);
}

async function firewall_read(app, remote)
{
    if (remote_can(remote, 'ufw') === false) {
        throw new Error('its agent is from before the firewall');
    }
    return await firewall_serve.read(v => remote_call(app, remote, 'ufw', {argv: v}, UFW_TIMEOUT_MS));
}

// The sockets as ss lists them, each port Docker publishes named by its container, and the
// ones Docker publishes with no socket of its own (its proxy turned off) added: those are let
// in by Docker's rules all the same
function items_with_docker(items, facts)
{
    const published = ((facts === null) || (facts.docker === null) || (facts.docker === undefined) || (Array.isArray(facts.docker.published) === false)) ? [] : facts.docker.published;
    const out = items.map(function (item) {
        const found = published.find(v => (v.port === item.port) && (v.proto === item.proto.replace(/6$/, '')));
        return (found === undefined) ? item : Object.assign({}, item, {docker: {name: found.name, image: found.image}});
    });
    for (const item of published) {
        if (out.some(v => (v.port === item.port) && (v.proto.replace(/6$/, '') === item.proto)) === false) {
            // A port published with no address named is on every address, Docker's own default
            out.push({proto: item.proto, address: (item.address === null) ? '0.0.0.0' : item.address, port: item.port, state: 'LISTEN', users: [], docker: {name: item.name, image: item.image}});
        }
    }
    return out;
}

// Where to knock: the machine's public addresses, and the one its agent dials in from when that
// is public too (a cloud machine whose public address is not on any of its interfaces). Not the
// machine this serviceman runs on: a knock from it on itself does not come from outside.
function knock_where(app, remote, facts, addresses, ip_kind)
{
    const docker = (facts === null) ? null : facts.docker;
    if ((app.own_container !== null) && (docker !== null) && (docker !== undefined) && Array.isArray(docker.ids) && docker.ids.includes(app.own_container)) {
        return {addresses: [], nat: false, skipped: 'serviceman runs on this machine, and a knock from it on itself does not come from outside'};
    }
    const own = (addresses === null) ? [] : addresses.filter(v => ip_kind(v) === 'public');
    const known = own.slice();
    const link = String(remote.state.address || '').replace(/^::ffff:/, '');
    if ((link !== '') && (ip_kind(link) === 'public') && (known.includes(link) === false)) {
        known.push(link);
    }
    // One of each kind is enough: the same machine answers on both, where it answers at all
    const v4 = known.find(v => v.includes('.'));
    const v6 = known.find(v => v.includes(':'));
    const picked = [v4, v6].filter(v => v !== undefined);
    if (picked.length === 0) {
        return {addresses: [], nat: false, skipped: 'no public address of this machine is known: its interfaces have none, and its agent dials in from a private one'};
    }
    // Reached at an address none of its interfaces has: the cloud hands what comes to it on to
    // a private one, so a port on a private address may be open to the internet too
    return {addresses: picked, nat: (own.length === 0), skipped: null};
}

// A tcp port that listens on an address the internet may reach: on every address, or on one
// of those knocked on. Datagrams have no answer to tell open from dropped, and are not knocked.
function knock_wanted(row, knocked)
{
    if ((row.proto !== 'tcp') || (row.port === 0) || (row.reach.exposure === 'local')) {
        return false;
    }
    return knocked.nat || row.addresses.some(v => WILDCARDS.includes(v) || knocked.addresses.includes(v));
}

// Each port knocked at each address it listens on, a few at a time; a port answers when it
// answers at any of them
async function knock_all(rows, knocked)
{
    const queue = rows.slice();
    async function worker() {
        while (queue.length > 0) {
            const row = queue.shift();
            const wildcard = knocked.nat || row.addresses.some(v => WILDCARDS.includes(v));
            const targets = knocked.addresses.filter(v => wildcard || row.addresses.includes(v));
            const answers = await Promise.all(targets.map(v => security_knock(v, row.port)));
            row.knock = ['answered', 'refused', 'silent', 'unreachable'].find(v => answers.includes(v)) || null;
        }
    }
    await Promise.all(Array.from({length: KNOCKS_AT_ONCE}, worker));
}

module.exports = security_of_remote;
