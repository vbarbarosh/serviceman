// What in the config names a machine, and so keeps it: a new name or Remove would leave it naming
// one that is gone, and the config refuses that. json is the config file's object, name the
// machine's; the answer is [{kind, name}], kind 'service', 'forward', 'mount', 'board' or
// 'load test', in the config's order. A service asking for a tag (#gpu) does not name it.
function remote_named_by(json, name)
{
    const out = [];
    for (const item of list_of(json.services)) {
        const remotes = (typeof item.remotes === 'string') ? [item.remotes] : list_of(item.remotes);
        if ((item.remote === name) || remotes.includes(name)) {
            out.push({kind: 'service', name: item.name});
        }
    }
    for (const [key, kind] of [['forwards', 'forward'], ['mounts', 'mount']]) {
        for (const item of list_of(json[key])) {
            if ([item.from, item.to].some(v => (v !== null) && (typeof v === 'object') && (v.remote === name))) {
                out.push({kind, name: item.label || `${kind} ${out.length + 1}`});
            }
        }
    }
    for (const item of list_of(json.boards)) {
        const machines = (typeof item.machines === 'string') ? [item.machines] : list_of(item.machines);
        if (machines.includes(name)) {
            out.push({kind: 'board', name: item.name});
        }
    }
    for (const item of list_of(json.load_tests)) {
        if (item.remote === name) {
            out.push({kind: 'load test', name: item.name || item.service});
        }
    }
    return out;
}

function list_of(value)
{
    return Array.isArray(value) ? value : [];
}

export default remote_named_by;
