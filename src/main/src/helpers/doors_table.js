const crypto = require('crypto');
const docker_container_name = require('./docker_container_name');
const door_peer_known = require('./door_peer_known');
const door_token = require('./door_token');
const remote_candidates = require('./remote_candidates');

// What one machine's door routes by, written here and kept on that machine, so it goes on
// routing when serviceman is away:
//
// - names: the names its door answers, each with the service behind it, the wall in front of
//   it and whether it is on;
// - services: where each of those runs, and where each service of this machine runs that
//   another machine's door names — so its agent can answer its peers;
// - peers: how to reach the other machines' agents, and the token each asks with;
// - token: the one its own peers ask it with.
//
// The version is the table's own fingerprint: the machine says which one it serves, and it is
// sent again only when that differs.
function doors_table(app, remote)
{
    const names = {};
    const wanted = new Set();
    for (const host of Object.keys(remote.inbound || {})) {
        const rule = rule_of(remote.inbound[host]);
        names[host] = rule;
        wanted.add(rule.service);
        if (rule.wall !== null) {
            wanted.add(rule.wall);
        }
    }
    // Services of this machine that another machine's door reaches: its peers ask for them
    let asked = false;
    for (const other of app.remotes) {
        if (other === remote) {
            continue;
        }
        for (const host of Object.keys(other.inbound || {})) {
            const rule = rule_of(other.inbound[host]);
            for (const name of [rule.service, rule.wall]) {
                const service = ((name === null) ? undefined : app.service_by_name[name]);
                if ((service !== undefined) && (place_of(app, service).machine === remote.name)) {
                    wanted.add(name);
                    asked = true;
                }
            }
        }
    }
    const services = {};
    for (const name of Array.from(wanted).sort()) {
        const service = app.service_by_name[name];
        if (service !== undefined) {
            services[name] = place_of(app, service);
        }
    }
    // Only the peers this machine's door reaches a service on, and a token only where one is
    // asked with: a machine nobody reaches has none
    const peers = {};
    for (const other of app.remotes) {
        // What it said at its hello, or — away since serviceman started — what it said before
        const peer = ((other === remote) ? null : (other.state.doors_peer || door_peer_known(app, other.name)));
        const used = Object.values(services).some(v => v.machine === other.name);
        if (used && (peer !== null) && (peer !== undefined)) {
            peers[other.name] = {addresses: peer.addresses, port: peer.port, token: door_token(app, other.name)};
        }
    }
    const table = {self: remote.name, token: (asked ? door_token(app, remote.name) : null), names, services, peers};
    const version = crypto.createHash('sha256').update(JSON.stringify(table)).digest('hex').slice(0, 12);
    return Object.assign({version}, table);
}

// A rule as the config holds it — a service's name alone, or {service, off, auth} — in the one
// shape the door reads
function rule_of(rule)
{
    if (typeof rule === 'string') {
        return {service: rule, wall: null, off: false};
    }
    return {service: rule.service, wall: (((rule.auth === undefined) || (rule.auth === null) || (rule.auth === '')) ? null : rule.auth), off: (rule.off === true)};
}

// Where a service runs and how its machine reaches it: the machine a running copy is on, or the
// first it may run on; a container by its name and the port inside, a program by its port, an
// address serviceman does not start by the address. A service with no machine — one this host
// answers itself — is null there, and a door hands its requests to serviceman.
function place_of(app, service)
{
    const running = service.state.instances.find(v => (v.remote !== null) && (v.remote !== undefined));
    const candidates = remote_candidates(app, service);
    const machine = ((running !== undefined) ? running.remote : ((candidates.length === 0) ? null : candidates[0].name));
    if (service.type === 'external') {
        const upstream = service.upstream;
        return {service: service.name, machine, kind: 'external', upstream: ((typeof upstream === 'string') ? upstream : `${upstream.host}:${upstream.port}`)};
    }
    if ((service.type === 'docker') || ((service.type === 'shell') && (service.image !== undefined) && (service.image !== null))) {
        return {service: service.name, machine, kind: 'docker', container: docker_container_name(service, 1), port: service.port};
    }
    return {service: service.name, machine, kind: 'program', port: service.port};
}

module.exports = doors_table;
