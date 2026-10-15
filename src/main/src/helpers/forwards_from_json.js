const RE_NAME = /^[a-z0-9][a-z0-9_-]*$/;
const RE_HOST = /^[A-Za-z0-9.:_-]+$/;
const END_FIELDS = ['remote', 'port', 'socket', 'host'];

// A port or a socket on one machine, answered by a port or a socket on another. Whatever
// connects to `from` is carried over both machines' links, through serviceman, to `to`:
//
//     "forwards": [
//         {"name": "loki", "from": {"remote": "laptop", "socket": "~/repos/loki.sock"}, "to": {"remote": "vps1", "port": 3100}}
//     ]
//
// `from` listens on the loopback of its machine (a port) or on a socket file only the agent's
// user may open. `to` is a port on its machine's loopback, or `host` with it for an address that
// machine reaches, or a socket file. `~/` in a socket is the home of the user the agent runs as.
function forwards_from_json(json, label)
{
    if ((json === undefined) || (json === null)) {
        return [];
    }
    if (Array.isArray(json) === false) {
        throw new Error(`${label}: a list of forwards, [{"name", "from": {"remote", "port" or "socket"}, "to": {...}}]`);
    }
    const out = [];
    for (let i = 0; i < json.length; i++) {
        const item = json[i];
        const at = `${label}[${i}]`;
        if ((item === null) || (typeof item !== 'object') || Array.isArray(item)) {
            throw new Error(`${at}: {"name", "from": {"remote", "port" or "socket"}, "to": {...}}`);
        }
        if ((typeof item.name !== 'string') || (RE_NAME.test(item.name) === false)) {
            throw new Error(`${at}.name: lowercase letters, digits, - and _ (got ${JSON.stringify(item.name)})`);
        }
        if (out.some(v => v.name === item.name)) {
            throw new Error(`${at}.name: ${JSON.stringify(item.name)} is used twice`);
        }
        const from = end_from_json(item.from, `${at}.from`);
        if (from.host !== null) {
            throw new Error(`${at}.from.host: a forward listens on its machine's loopback and nowhere else`);
        }
        const to = end_from_json(item.to, `${at}.to`);
        if ((to.socket !== null) && (to.host !== null)) {
            throw new Error(`${at}.to.host: a host goes with a port, not with a socket`);
        }
        const taken = out.find(v => (v.from.remote === from.remote) && (v.from.port === from.port) && (v.from.socket === from.socket));
        if (taken !== undefined) {
            throw new Error(`${at}.from: ${taken.name} already listens there`);
        }
        out.push({name: item.name, from, to, off: item.off === true});
    }
    return out;
}

function end_from_json(json, label)
{
    if ((json === null) || (typeof json !== 'object') || Array.isArray(json)) {
        throw new Error(`${label}: {"remote": "<a machine>", "port": 3100} or {"remote": "<a machine>", "socket": "~/app.sock"}`);
    }
    for (const key of Object.keys(json)) {
        if (END_FIELDS.includes(key) === false) {
            throw new Error(`${label}.${key}: not a field of a forward's end — ${END_FIELDS.join(', ')}`);
        }
    }
    if ((typeof json.remote !== 'string') || (json.remote === '')) {
        throw new Error(`${label}.remote: the machine this end is on`);
    }
    if ((json.port === undefined) === (json.socket === undefined)) {
        throw new Error(`${label}: one of "port" or "socket"`);
    }
    if ((json.port !== undefined) && ((Number.isInteger(json.port) === false) || (json.port < 1) || (json.port > 65535))) {
        throw new Error(`${label}.port: a port from 1 to 65535 (got ${JSON.stringify(json.port)})`);
    }
    if ((json.socket !== undefined) && ((typeof json.socket !== 'string') || ((json.socket.startsWith('/') || json.socket.startsWith('~/')) === false) || (json.socket.length > 100))) {
        throw new Error(`${label}.socket: a path from / or ~/, of at most 100 characters (got ${JSON.stringify(json.socket)})`);
    }
    if ((json.host !== undefined) && ((typeof json.host !== 'string') || (RE_HOST.test(json.host) === false))) {
        throw new Error(`${label}.host: an address that machine reaches, such as 10.0.0.5 (got ${JSON.stringify(json.host)})`);
    }
    return {
        remote: json.remote,
        port: ((json.port === undefined) ? null : json.port),
        socket: ((json.socket === undefined) ? null : json.socket),
        host: ((json.host === undefined) ? null : json.host),
    };
}

module.exports = forwards_from_json;
