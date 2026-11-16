const RE_LINE_BREAK = /[\x00-\x1f\x7f]/;
const LABEL_MAX = 100;
const PATH_MAX = 200;
const MODES = ['ro', 'rw'];
// No mount goes over the system's own folders (agent_mounts says the same on the machine)
const PATHS_REFUSED = ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/proc', '/run', '/sbin', '/sys', '/usr', '/var/lib/serviceman'];

// A folder of one machine, mounted on another, as Forwards bring a port: `from` is where the
// folder is, `to` where it shows up, read-only (`ro`) or read-write (`rw`). sshfs on `to`
// speaks SFTP over both machines' links, through serviceman, to the folder on `from`, which
// shows it and nothing outside it (sftp_stream):
//
//     "mounts": [
//         {"label": "photos", "from": {"remote": "laptop", "path": "~/Pictures"}, "to": {"remote": "vps1", "path": "/mnt/photos"}, "mode": "ro"}
//     ]
//
// `from` may be serviceman itself, `"here": true`, with a path inside its state dir written from
// it; `.` is the state dir whole:
//
//     {"label": "serviceman's data", "from": {"here": true, "path": "."}, "to": {"remote": "vps1", "path": "/mnt/serviceman"}, "mode": "ro"}
//
// `to` is always a machine with the agent's root half, which mounts it. `off` sets it aside:
// written down, and not mounted.
function mounts_from_json(json, label)
{
    if ((json === undefined) || (json === null)) {
        return [];
    }
    if (Array.isArray(json) === false) {
        throw new Error(`${label}: a list of mounts, [{"label", "from": {"remote", "path"}, "to": {"remote", "path"}, "mode"}]`);
    }
    const out = [];
    for (let i = 0; i < json.length; i++) {
        const item = json[i];
        const at = `${label}[${i}]`;
        if ((item === null) || (typeof item !== 'object') || Array.isArray(item)) {
            throw new Error(`${at}: {"label", "from": {"remote", "path"}, "to": {"remote", "path"}, "mode"}`);
        }
        for (const key of Object.keys(item)) {
            if (['label', 'from', 'to', 'mode', 'off'].includes(key) === false) {
                throw new Error(`${at}.${key}: not a field of a mount — label, from, to, mode, off`);
            }
        }
        if ((typeof item.label !== 'string') || (item.label.trim() !== item.label) || (item.label === '') || (item.label.length > LABEL_MAX) || RE_LINE_BREAK.test(item.label)) {
            throw new Error(`${at}.label: any text of one line, at most ${LABEL_MAX} characters, with no spaces around it (got ${JSON.stringify(item.label)})`);
        }
        if (out.some(v => v.label === item.label)) {
            throw new Error(`${at}.label: ${JSON.stringify(item.label)} is used twice`);
        }
        const mode = (item.mode === undefined) ? 'ro' : item.mode;
        if (MODES.includes(mode) === false) {
            throw new Error(`${at}.mode: "ro" for read-only, or "rw" for read-write (got ${JSON.stringify(item.mode)})`);
        }
        if ((item.off !== undefined) && (typeof item.off !== 'boolean')) {
            throw new Error(`${at}.off: true or false (got ${JSON.stringify(item.off)})`);
        }
        const from = from_from_json(item.from, `${at}.from`);
        const to = to_from_json(item.to, `${at}.to`);
        const taken = out.find(v => (v.to.remote === to.remote) && ((v.to.path === to.path) || v.to.path.startsWith(`${to.path}/`) || to.path.startsWith(`${v.to.path}/`)));
        if (taken !== undefined) {
            throw new Error(`${at}.to.path: ${JSON.stringify(taken.label)} is mounted at ${taken.to.path} on ${to.remote}; two mounts never share a path, nor sit one inside the other`);
        }
        if ((from.remote !== null) && (from.remote === to.remote)) {
            throw new Error(`${at}: a folder is mounted on another machine than its own`);
        }
        out.push({label: item.label, from, to, mode, off: item.off === true});
    }
    return out;
}

function from_from_json(json, label)
{
    if ((json === null) || (typeof json !== 'object') || Array.isArray(json)) {
        throw new Error(`${label}: {"remote": "<a machine>", "path": "~/folder"} or {"here": true, "path": "."}`);
    }
    for (const key of Object.keys(json)) {
        if (['remote', 'here', 'path'].includes(key) === false) {
            throw new Error(`${label}.${key}: not a field of a mount's from — remote, here, path`);
        }
    }
    if ((json.here !== undefined) && (json.here !== true)) {
        throw new Error(`${label}.here: true, or left out (got ${JSON.stringify(json.here)})`);
    }
    if (json.here === true) {
        if (json.remote !== undefined) {
            throw new Error(`${label}: one of "here" or "remote", not both`);
        }
        if (inside_state_dir(json.path) === false) {
            throw new Error(`${label}.path: a folder inside serviceman's state dir, written from it — "." for the whole of it, or like logs — never from / or ~/, and never through .. (got ${JSON.stringify(json.path)})`);
        }
        return {remote: null, here: true, path: json.path};
    }
    if ((typeof json.remote !== 'string') || (json.remote === '')) {
        throw new Error(`${label}.remote: the machine the folder is on`);
    }
    if ((typeof json.path !== 'string') || ((json.path.startsWith('/') || json.path.startsWith('~/') || (json.path === '~')) === false) || (json.path.length > PATH_MAX) || RE_LINE_BREAK.test(json.path)) {
        throw new Error(`${label}.path: a folder from / or ~/, of at most ${PATH_MAX} characters (got ${JSON.stringify(json.path)})`);
    }
    if (json.path === '/') {
        throw new Error(`${label}.path: the whole disk is never mounted elsewhere; name a folder of it`);
    }
    return {remote: json.remote, here: false, path: json.path};
}

function to_from_json(json, label)
{
    if ((json === null) || (typeof json !== 'object') || Array.isArray(json)) {
        throw new Error(`${label}: {"remote": "<a machine>", "path": "/mnt/folder"}`);
    }
    for (const key of Object.keys(json)) {
        if (['remote', 'path'].includes(key) === false) {
            throw new Error(`${label}.${key}: not a field of a mount's to — remote, path (serviceman itself mounts nothing)`);
        }
    }
    if ((typeof json.remote !== 'string') || (json.remote === '')) {
        throw new Error(`${label}.remote: the machine the folder is mounted on`);
    }
    const value = json.path;
    if ((typeof value !== 'string') || (value.startsWith('/') === false) || (value.length > PATH_MAX) || RE_LINE_BREAK.test(value) || value.endsWith('/') || value.split('/').some((v, i) => (i > 0) && ((v === '') || (v === '.') || (v === '..')))) {
        throw new Error(`${label}.path: a full path, like /mnt/photos (got ${JSON.stringify(value)})`);
    }
    if (value.split('/').length < 3) {
        throw new Error(`${label}.path: ${value} is a folder of the system's own; a mount goes one level deeper, like ${(value === '/') ? '/mnt' : value}/data`);
    }
    const under = PATHS_REFUSED.find(v => (value === v) || value.startsWith(`${v}/`));
    if (under !== undefined) {
        throw new Error(`${label}.path: ${value} is under ${under}, the system's own`);
    }
    return {remote: json.remote, path: value};
}

// A folder of serviceman's own stays in its state dir: `.` for the whole, or a relative path
// none of whose steps goes up
function inside_state_dir(value)
{
    if ((typeof value !== 'string') || (value === '') || (value.length > PATH_MAX) || RE_LINE_BREAK.test(value)) {
        return false;
    }
    if (value === '.') {
        return true;
    }
    if (value.startsWith('/') || value.startsWith('~')) {
        return false;
    }
    return value.split('/').every(v => (v !== '') && (v !== '.') && (v !== '..'));
}

module.exports = mounts_from_json;
