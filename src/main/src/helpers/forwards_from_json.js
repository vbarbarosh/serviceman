const net = require('net');
const RE_LINE_BREAK = /[\x00-\x1f\x7f]/;
const LABEL_MAX = 100;
const RE_HOST = /^[A-Za-z0-9.:_-]+$/;
const END_FIELDS = ['remote', 'here', 'port', 'socket', 'host'];
const SOCKET_MAX = 100;
const RE_TOKEN_ID = /^[0-9a-f]{1,64}$/;
const RE_SERVICE = /^[a-z0-9][a-z0-9_-]*$/;
// A database server's name, as the Databases page makes it
const RE_DATABASE = /^[a-z][a-z0-9-]{0,39}$/;
// How many addresses and networks a public port may let in
const ALLOW_MAX = 50;

// A port or a socket of one machine, brought to another, the way `ssh -L` brings one: `from` is
// where the service is, `to` is where it shows up. Whatever connects at `to` is carried over
// both machines' links, through serviceman, to `from`:
//
//     "forwards": [
//         {"label": "Loki on vps1", "from": {"remote": "vps1", "port": 3100}, "to": {"remote": "laptop", "socket": "~/repos/loki.sock"}}
//     ]
//
// `from` is a port on its machine's loopback, or `host` with it for an address that machine
// reaches, or a socket file. `to` listens on the loopback of its machine (a port) or on a socket
// file only the agent's user may open. `~/` in a socket is the home of the user the agent runs as.
//
// `to` may be serviceman itself instead of a machine, `"here": true`: it listens then, on its own
// loopback or on a socket file inside its state dir, written relative to it (forwards_here):
//
//     {"label": "loki", "from": {"remote": "vps1", "port": 3100}, "to": {"here": true, "socket": "sockets/loki.sock"}}
//
// `label` is any text of one line, one per forward: it is how the page, the totals and the logs
// know the forward, and never a path or an address. A config from before labels has `name`.
//
// `by` is the token that asked for it, when one did: serviceman writes it, from the token, on a
// forward a token's PUT adds or changes, `{"token": "<its id>", "label": "<its label then>"}`,
// and sets the forward aside when that token is revoked or may no longer hold it.
//
// `service` is the service it is part of, when it is one: the program whose port it brings over,
// written by the program's form. It goes with that service: renamed with it, taken out with it,
// and its `from` moves with the machine the program runs on (service_rename_ties, the service
// routes). A forward with no `service` is one of its own. Only the owner writes one (a token's
// list is refused it, forward_token_refusal), and config_from_json checks the service is there.
//
// `database` is the database server it is part of, the same way: its port brought to another
// machine, written by the database's page. serviceman keeps its `from` on the server's machine
// and port, a port docker may change at a start, and takes it out with the server
// (database_forwards_follow, handle_databases). The server is kept beside the config, not in it.
//
// A database server's public port is one more: its `to` on the server's own machine with
// `host` 0.0.0.0, listening on every address the machine has, where every other forward listens
// on its loopback alone. `tls` true makes it speak TLS, with a certificate serviceman keeps beside
// the server (database_public_tls); `allow` lets in those addresses and networks alone, [] for
// everyone.
function forwards_from_json(json, label)
{
    if ((json === undefined) || (json === null)) {
        return [];
    }
    if (Array.isArray(json) === false) {
        throw new Error(`${label}: a list of forwards, [{"label", "from": {"remote", "port" or "socket"}, "to": {...}}]`);
    }
    const out = [];
    for (let i = 0; i < json.length; i++) {
        const item = json[i];
        const at = `${label}[${i}]`;
        if ((item === null) || (typeof item !== 'object') || Array.isArray(item)) {
            throw new Error(`${at}: {"label", "from": {"remote", "port" or "socket"}, "to": {...}}`);
        }
        const forward_label = (item.label === undefined) ? item.name : item.label;
        if ((typeof forward_label !== 'string') || (forward_label.trim() !== forward_label) || (forward_label === '') || (forward_label.length > LABEL_MAX) || RE_LINE_BREAK.test(forward_label)) {
            throw new Error(`${at}.label: any text of one line, at most ${LABEL_MAX} characters, with no spaces around it (got ${JSON.stringify(forward_label)})`);
        }
        if (out.some(v => v.label === forward_label)) {
            throw new Error(`${at}.label: ${JSON.stringify(forward_label)} is used twice`);
        }
        const from = end_from_json(item.from, `${at}.from`, false);
        if ((from.socket !== null) && (from.host !== null)) {
            throw new Error(`${at}.from.host: a host goes with a port, not with a socket`);
        }
        const to = end_from_json(item.to, `${at}.to`, true);
        const database = database_from_json(item.database, `${at}.database`);
        public_check(to, from, database, `${at}.to`);
        // Both ends on one machine is a forward its agent joins itself; one that would dial where
        // it listens would open one more connection for each it takes, without end
        if ((to.here === false) && (from.remote === to.remote) && end_loops(from, to)) {
            throw new Error(`${at}.from: where the forward listens itself, on ${to.remote}; each connection would reach itself`);
        }
        const taken = out.find(v => (v.to.remote === to.remote) && (v.to.port === to.port) && (v.to.socket === to.socket));
        if (taken !== undefined) {
            throw new Error(`${at}.to: ${JSON.stringify(taken.label)} already listens there`);
        }
        const service = service_from_json(item.service, `${at}.service`);
        if ((service !== null) && (database !== null)) {
            throw new Error(`${at}.database: a forward is part of a service or of a database server, not both`);
        }
        const tls = tls_from_json(item.tls, to, `${at}.tls`);
        const allow = allow_from_json(item.allow, to, `${at}.allow`);
        out.push({label: forward_label, from, to, off: item.off === true, by: by_from_json(item.by, `${at}.by`), service, database, tls, allow});
    }
    return out;
}

// The token a forward was asked for by, or null for one the owner wrote
function by_from_json(json, label)
{
    if (json === undefined) {
        return null;
    }
    if ((json === null) || (typeof json !== 'object') || Array.isArray(json) || (typeof json.token !== 'string') || (RE_TOKEN_ID.test(json.token) === false) || (typeof json.label !== 'string') || (json.label.length > LABEL_MAX) || RE_LINE_BREAK.test(json.label)) {
        throw new Error(`${label}: {"token": "<a token's id>", "label": "<its label>"}, written by serviceman for a forward a token asked for (got ${JSON.stringify(json)})`);
    }
    return {token: json.token, label: json.label};
}

// The service a forward is part of, or null for one of its own
function service_from_json(json, label)
{
    if (json === undefined) {
        return null;
    }
    if ((typeof json !== 'string') || (RE_SERVICE.test(json) === false)) {
        throw new Error(`${label}: the name of the service it is part of, or left out (got ${JSON.stringify(json)})`);
    }
    return json;
}

// A public port: `to` listens on every address of its machine, `host` 0.0.0.0, and nowhere but
// a database server's own machine, for its port alone; every other forward shows up on its
// machine's loopback
function public_check(to, from, database, label)
{
    if (to.host === null) {
        return;
    }
    if (database === null) {
        throw new Error(`${label}.host: a forward shows up on its machine's loopback and nowhere else`);
    }
    if (to.host !== '0.0.0.0') {
        throw new Error(`${label}.host: 0.0.0.0, every address of its machine, or left out for its loopback (got ${JSON.stringify(to.host)})`);
    }
    if (to.here || (to.socket !== null) || (to.remote !== from.remote)) {
        throw new Error(`${label}: a public port is a port on its server's own machine, ${from.remote}`);
    }
}

// Whether a public port speaks TLS: false, or left out, for one that does not; never on any
// other forward
function tls_from_json(json, to, label)
{
    if (json === undefined) {
        return false;
    }
    if (typeof json !== 'boolean') {
        throw new Error(`${label}: true or false (got ${JSON.stringify(json)})`);
    }
    if (json && (to.host === null)) {
        throw new Error(`${label}: TLS is a public port's, one whose "to" has "host": "0.0.0.0"`);
    }
    return json;
}

// Who a public port lets in: addresses and networks, [] or left out for everyone; never on any
// other forward
function allow_from_json(json, to, label)
{
    if (json === undefined) {
        return [];
    }
    if ((Array.isArray(json) === false) || (json.length > ALLOW_MAX)) {
        throw new Error(`${label}: a list of at most ${ALLOW_MAX} addresses and networks, such as ["203.0.113.5", "10.0.0.0/8"] (got ${JSON.stringify(json)})`);
    }
    for (const item of json) {
        if (address_or_network(item) === false) {
            throw new Error(`${label}: an address or a network, such as 203.0.113.5 or 10.0.0.0/8 (got ${JSON.stringify(item)})`);
        }
    }
    if ((json.length > 0) && (to.host === null)) {
        throw new Error(`${label}: who may connect is a public port's, one whose "to" has "host": "0.0.0.0"`);
    }
    return json;
}

// 203.0.113.5, 10.0.0.0/8, 2001:db8::5 or 2001:db8::/32
function address_or_network(text)
{
    if (typeof text !== 'string') {
        return false;
    }
    const [address, prefix, more] = text.split('/');
    const kind = net.isIP(address);
    if ((kind === 0) || (more !== undefined)) {
        return false;
    }
    if (prefix === undefined) {
        return true;
    }
    return /^\d{1,3}$/.test(prefix) && (Number(prefix) <= ((kind === 4) ? 32 : 128));
}

// The database server a forward is part of, or null for none
function database_from_json(json, label)
{
    if (json === undefined) {
        return null;
    }
    if ((typeof json !== 'string') || (RE_DATABASE.test(json) === false)) {
        throw new Error(`${label}: the name of the database server it is part of, or left out (got ${JSON.stringify(json)})`);
    }
    return json;
}

// `here_allowed` is for `to`: a service is on a machine with an agent, and only where it shows
// up may be serviceman itself
function end_from_json(json, label, here_allowed)
{
    if ((json === null) || (typeof json !== 'object') || Array.isArray(json)) {
        throw new Error(`${label}: {"remote": "<a machine>", "port": 3100} or {"remote": "<a machine>", "socket": "~/app.sock"}`);
    }
    for (const key of Object.keys(json)) {
        if (END_FIELDS.includes(key) === false) {
            throw new Error(`${label}.${key}: not a field of a forward's end — ${END_FIELDS.join(', ')}`);
        }
    }
    if ((json.here !== undefined) && (json.here !== true)) {
        throw new Error(`${label}.here: true, or left out (got ${JSON.stringify(json.here)})`);
    }
    const here = (json.here === true);
    if (here && (here_allowed === false)) {
        throw new Error(`${label}.here: the service is on a machine with an agent — serviceman itself may only be where a forward shows up, in "to"`);
    }
    if (here && (json.remote !== undefined)) {
        throw new Error(`${label}: one of "here" or "remote", not both`);
    }
    if ((here === false) && ((typeof json.remote !== 'string') || (json.remote === ''))) {
        throw new Error(`${label}.remote: the machine this end is on`);
    }
    if ((json.port === undefined) === (json.socket === undefined)) {
        throw new Error(`${label}: one of "port" or "socket"`);
    }
    if ((json.port !== undefined) && ((Number.isInteger(json.port) === false) || (json.port < 1) || (json.port > 65535))) {
        throw new Error(`${label}.port: a port from 1 to 65535 (got ${JSON.stringify(json.port)})`);
    }
    if (here && (json.socket !== undefined) && (socket_inside(json.socket) === false)) {
        throw new Error(`${label}.socket: a path inside serviceman's state dir, written from it, such as sockets/loki.sock — not from / or ~/, and never through .. — of at most ${SOCKET_MAX} characters (got ${JSON.stringify(json.socket)})`);
    }
    if ((here === false) && (json.socket !== undefined) && ((typeof json.socket !== 'string') || ((json.socket.startsWith('/') || json.socket.startsWith('~/')) === false) || (json.socket.length > SOCKET_MAX))) {
        throw new Error(`${label}.socket: a path from / or ~/, of at most ${SOCKET_MAX} characters (got ${JSON.stringify(json.socket)})`);
    }
    if ((json.host !== undefined) && ((typeof json.host !== 'string') || (RE_HOST.test(json.host) === false))) {
        throw new Error(`${label}.host: an address that machine reaches, such as 10.0.0.5 (got ${JSON.stringify(json.host)})`);
    }
    return {
        remote: here ? null : json.remote,
        here,
        port: (json.port === undefined) ? null : json.port,
        socket: (json.socket === undefined) ? null : json.socket,
        host: (json.host === undefined) ? null : json.host,
    };
}

// Whether the far end of a forward on one machine is where it listens: the same socket file, or
// the same port on its loopback
function end_loops(from, to)
{
    if (from.socket !== null) {
        return (from.socket === to.socket);
    }
    const loopback = (from.host === null) || (from.host === '127.0.0.1') || (from.host === 'localhost');
    return loopback && (from.port === to.port);
}

// A socket of serviceman's own stays in its state dir: a relative path that names a file, and
// no step of it goes up
function socket_inside(value)
{
    if ((typeof value !== 'string') || (value === '') || (value.length > SOCKET_MAX)) {
        return false;
    }
    if (value.startsWith('/') || value.startsWith('~') || value.includes('\0')) {
        return false;
    }
    return value.split('/').every(v => (v !== '') && (v !== '.') && (v !== '..'));
}

module.exports = forwards_from_json;
