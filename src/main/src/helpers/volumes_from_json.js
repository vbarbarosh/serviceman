const os = require('os');
const path = require('path');

// Storage lines of one service: 'name:/data', '/srv/x:/data:ro' or {source, target, readonly, create}
function volumes_from_json(json, base_dir, label, service)
{
    if (json === undefined) {
        return [];
    }
    if (Array.isArray(json) === false) {
        throw new Error(`${label}: a list of volumes is required`);
    }
    const out = [];
    for (let i = 0; i < json.length; i++) {
        out.push(volume_from_json(json[i], base_dir, `${label}[${i}]`, service));
    }
    return out;
}

function volume_from_json(json, base_dir, label, service)
{
    const parts = ((typeof json === 'string') ? parts_from_text(json, label) : parts_from_object(json, label));
    if (parts.target.startsWith('/') === false) {
        throw new Error(`${label}: the target is the path inside the container, it starts with / (got ${JSON.stringify(parts.target)})`);
    }
    // No name: a path this service keeps across starts, and nowhere else. It is a folder in
    // the agent's own directory — `data/<service>/<what it is for>` — so everything the agent
    // made is in one place and goes with it. Naming it is nobody's job.
    if (parts.source === '') {
        if ((service === undefined) || (service === '')) {
            throw new Error(`${label}: a name is required here — only a service's own storage may be left unnamed`);
        }
        return {
            kind: 'kept',
            source: '',
            keep: `${service}/${slug_of(parts.target)}`,
            target: parts.target,
            readonly: parts.readonly,
            create: true,
        };
    }
    const kind = ((parts.source.includes('/') || parts.source.startsWith('~')) ? 'path' : 'volume');
    return {
        kind,
        source: ((kind === 'path') ? path.resolve(base_dir, home_expanded(parts.source)) : parts.source),
        target: parts.target,
        readonly: parts.readonly,
        create: ((kind === 'path') && parts.create),
    };
}

// What a path inside the container is called outside it: `/app/data` is `app-data`
function slug_of(target)
{
    return target.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9_.-]+/g, '-').toLowerCase();
}

function parts_from_text(text, label)
{
    const items = text.split(':');
    if (items.length === 2) {
        return {source: items[0], target: items[1], readonly: false, create: true};
    }
    if ((items.length === 3) && ((items[2] === 'ro') || (items[2] === 'rw'))) {
        return {source: items[0], target: items[1], readonly: items[2] === 'ro', create: true};
    }
    throw new Error(`${label}: expected source:target or source:target:ro (got ${JSON.stringify(text)})`);
}

function parts_from_object(json, label)
{
    if ((json === null) || (typeof json !== 'object')) {
        throw new Error(`${label}: expected a string or a {source, target} object`);
    }
    if (typeof json.source !== 'string') {
        throw new Error(`${label}.source: a named volume, a path on this host, or nothing for storage of its own`);
    }
    if ((typeof json.target !== 'string') || (json.target.length === 0)) {
        throw new Error(`${label}.target: the path inside the container is required`);
    }
    return {
        source: json.source,
        target: json.target,
        readonly: json.readonly === true,
        create: ((json.create === undefined) ? true : json.create === true),
    };
}

function home_expanded(text)
{
    if ((text === '~') || text.startsWith('~/')) {
        return path.join(os.homedir(), text.slice(1));
    }
    return text;
}

module.exports = volumes_from_json;
