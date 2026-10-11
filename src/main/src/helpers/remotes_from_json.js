const assert_remote_valid = require('./assert_remote_valid');

const RE_TAG = /^[a-z0-9][a-z0-9_-]*$/;

// The machines that carry services; each waits for its own agent to dial in
function remotes_from_json(json, label)
{
    const out = [];
    if (json === undefined) {
        return out;
    }
    if (Array.isArray(json) === false) {
        throw new Error(`${label}: an array of remote definitions is required`);
    }
    for (let i = 0; i < json.length; i++) {
        const remote = {
            name: String(json[i].name || ''),
            title: json[i].title || json[i].name || '',
            token: json[i].token,
            tags: tags_from_json(json[i].tags, `${label}[${i}].tags`),
            machine: ((json[i].machine === undefined) ? null : String(json[i].machine)),
            inbound: inbound_from_json(json[i].inbound, `${label}[${i}].inbound`),
            logs: logs_from_json(json[i].logs, `${label}[${i}].logs`),
            log_dirs: log_dirs_from_json(json[i].log_dirs, `${label}[${i}].log_dirs`),
        };
        assert_remote_valid(remote, `${label}[${i}]`);
        if (out.some(v => v.name === remote.name)) {
            throw new Error(`${label}[${i}].name: ${JSON.stringify(remote.name)} is used twice`);
        }
        // An agent says who it is by its token alone, so two machines sharing one could not be
        // told apart — and either could read the other's orders
        const twin = out.find(v => v.token === remote.token);
        if (twin !== undefined) {
            throw new Error(`${label}[${i}].token: the same token is on remote ${JSON.stringify(twin.name)} — a token is what names the machine, so each needs its own (openssl rand -hex 32)`);
        }
        out.push(remote);
    }
    return out;
}

// What this machine's own door serves: a name, and the service that answers it. The requests
// come in through the agent from whatever stands in front of that machine, and each name says
// which service takes it — so a service keeps the address it already has, and a door adds one
// rather than renaming anything.
//
// Nothing by default: a door with no names on it serves none, and a machine gains that power
// only when somebody writes it down here.
function inbound_from_json(json, label)
{
    if (json === undefined) {
        return {};
    }
    if ((typeof json !== 'object') || (json === null) || Array.isArray(json)) {
        throw new Error(`${label}: a name and the service that answers it — {"echo.example.com": "echo"}`);
    }
    const out = {};
    for (const host of Object.keys(json)) {
        if ((host === '') || (host !== host.toLowerCase()) || /[:/\s]/.test(host)) {
            throw new Error(`${label}: a hostname, lowercase, with no port and no path (got ${JSON.stringify(host)}). ${JSON.stringify('*.example.com')} stands for every name under it`);
        }
        out[host] = rule_from_json(json[host], `${label}[${JSON.stringify(host)}]`);
    }
    return out;
}

// What answers one name, and whether it is answering at all. A rule written as a name is on —
// which is how one is written by hand and how this page writes the usual case. One that is off
// keeps its place: a name is switched off for an afternoon far more often than it is meant to
// be forgotten, and retyping it is how a name comes back subtly different.
function rule_from_json(json, label)
{
    if (typeof json === 'string') {
        if (json === '') {
            throw new Error(`${label}: the name of the service that answers it is required`);
        }
        return {service: json, off: false, auth: null};
    }
    if ((typeof json !== 'object') || (json === null) || Array.isArray(json)) {
        throw new Error(`${label}: the name of the service that answers it, or {"service": "echo", "off": true}`);
    }
    if ((typeof json.service !== 'string') || (json.service === '')) {
        throw new Error(`${label}.service: the name of the service that answers it is required`);
    }
    if ((json.auth !== undefined) && ((typeof json.auth !== 'string') || (json.auth === ''))) {
        throw new Error(`${label}.auth: the name of the service that stands in front of it — an authwall`);
    }
    return {service: json.service, off: json.off === true, auth: ((json.auth === undefined) ? null : json.auth)};
}

// Whether this machine sends the output of its containers to Logline: "all" of them, or none.
// None until somebody says so — a machine's logs leave it only when that is written down here.
function logs_from_json(json, label)
{
    if (json === undefined) {
        return 'off';
    }
    if ((json !== 'all') && (json !== 'off')) {
        throw new Error(`${label}: "all" sends every container's output to Logline, "off" sends none (got ${JSON.stringify(json)})`);
    }
    return json;
}

// The folders on this machine whose files go to Logline besides its containers' output:
// [{"path": "/var/log/nginx/*.log", "service": "nginx"}]. A path is a folder — every file in it —
// or a folder and a pattern for the files; ~/ is the home of whoever runs the agent. `service`
// names what the lines are about; without it, the folder's own name does.
function log_dirs_from_json(json, label)
{
    if (json === undefined) {
        return [];
    }
    if (Array.isArray(json) === false) {
        throw new Error(`${label}: a list of folders is required — [{"path": "/var/log/nginx/*.log", "service": "nginx"}]`);
    }
    const out = [];
    for (let i = 0; i < json.length; i++) {
        const item = ((typeof json[i] === 'string') ? {path: json[i]} : json[i]);
        if ((item === null) || (typeof item !== 'object') || (typeof item.path !== 'string') || (/^(\/|~\/)/.test(item.path) === false)) {
            throw new Error(`${label}[${i}].path: a folder on that machine, from / or ~/ (got ${JSON.stringify(((item === null) || (typeof item !== 'object')) ? item : item.path)})`);
        }
        if ((item.service !== undefined) && ((typeof item.service !== 'string') || (/^[a-z0-9][a-z0-9_.-]*$/i.test(item.service) === false))) {
            throw new Error(`${label}[${i}].service: a name, letters, digits, - . and _ (got ${JSON.stringify(item.service)})`);
        }
        if (out.some(v => v.path === item.path)) {
            throw new Error(`${label}[${i}].path: ${JSON.stringify(item.path)} is listed twice`);
        }
        out.push({path: item.path, service: ((item.service === undefined) ? null : item.service)});
    }
    return out;
}

// What a machine is, in words a service can ask for: gpu, eu, big-disk. They are facts about
// the machine, written here by whoever runs serviceman — never claimed by the machine itself.
function tags_from_json(json, label)
{
    if (json === undefined) {
        return [];
    }
    if (Array.isArray(json) === false) {
        throw new Error(`${label}: a list of tags is required`);
    }
    const out = [];
    for (const item of json) {
        if ((typeof item !== 'string') || (RE_TAG.test(item) === false)) {
            throw new Error(`${label}: a tag is lowercase letters, digits, - and _ (got ${JSON.stringify(item)})`);
        }
        if (out.includes(item)) {
            throw new Error(`${label}: ${JSON.stringify(item)} is listed twice`);
        }
        out.push(item);
    }
    return out;
}

module.exports = remotes_from_json;
