const RE_LINE_BREAK = /[\x00-\x1f\x7f]/;
const LABEL_MAX = 100;
const RE_HOST = /^[A-Za-z0-9.:_-]+$/;
const END_FIELDS = ['remote', 'here', 'port', 'socket', 'host'];
const SOCKET_MAX = 100;

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
        const forward_label = ((item.label === undefined) ? item.name : item.label);
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
        if (to.host !== null) {
            throw new Error(`${at}.to.host: a forward shows up on its machine's loopback and nowhere else`);
        }
        const taken = out.find(v => (v.to.remote === to.remote) && (v.to.port === to.port) && (v.to.socket === to.socket));
        if (taken !== undefined) {
            throw new Error(`${at}.to: ${JSON.stringify(taken.label)} already listens there`);
        }
        out.push({label: forward_label, from, to, off: item.off === true});
    }
    return out;
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
        remote: (here ? null : json.remote),
        here,
        port: ((json.port === undefined) ? null : json.port),
        socket: ((json.socket === undefined) ? null : json.socket),
        host: ((json.host === undefined) ? null : json.host),
    };
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
