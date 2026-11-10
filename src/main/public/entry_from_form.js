// The entry a form saves: the one the config file has, changed only where the form changed it.
// A form shows some of an entry's keys and writes the entry from its fields; saved as written,
// every other key of the file's entry would go, with "saved" on the screen. So the form says
// what it writes twice, with the same writer: `seen` for the entry untouched, `written` for
// the fields as they are now. The file's entry changes only where the two differ:
//
//     in both, the same             it stays as the file spells it
//     in `written`, new or another  it is written
//     in `seen` alone               it was emptied in the form, and goes
//     in neither                    the form knows nothing about it: it stays
//
// `shape` says what the writer does with the keys that are not one plain value each:
//
//     {remote: 'remotes', remotes: 'remote'}  two keys that say one thing: when the form writes
//                                             or empties one, the other goes
//     {policy: {}}                            an object the form writes some keys of: it is
//                                             changed key by key, by the shape beside its name
//
// Any other key is one value, written whole. A key the file did not have goes where the form
// writes it, after the key the form writes before it, and nothing else moves.
function entry_from_form(original, seen, written, shape)
{
    const changed = Object.assign({}, original);
    for (const key of Object.keys(seen)) {
        if (written[key] !== undefined) {
            continue;
        }
        // Emptied in the form. An object it writes some keys of keeps the rest, and goes when
        // there is no rest
        const rest = (is_fields(shape[key]) && is_fields(seen[key]) && is_fields(changed[key])) ? entry_from_form(changed[key], seen[key], {}, shape[key]) : {};
        delete changed[key];
        twin_drop(changed, shape, key);
        if (Object.keys(rest).length > 0) {
            changed[key] = rest;
        }
    }
    for (const key of Object.keys(written)) {
        if ((written[key] === undefined) || is_same(seen[key], written[key])) {
            continue;
        }
        twin_drop(changed, shape, key);
        changed[key] = value_from_form(changed[key], seen[key], written[key], shape[key]);
    }
    // The file's own order, a new key after the key the form writes before it
    const keys = Object.keys(original).filter(v => (changed[v] !== undefined));
    let at = 0;
    for (const key of Object.keys(written)) {
        if (keys.includes(key)) {
            at = keys.indexOf(key) + 1;
        }
        else if (changed[key] !== undefined) {
            keys.splice(at, 0, key);
            at++;
        }
    }
    const out = {};
    for (const key of keys) {
        out[key] = changed[key];
    }
    return out;
}

// One value the form changed. An object the shape names is changed key by key. In a list, an
// item the form left as it was stays as the file spells it: a storage line the file writes as
// {"source": "/srv/x", "target": "/data", "create": false} is "/srv/x:/data" to the form.
// Anything else is written whole.
function value_from_form(original, seen, written, shape)
{
    if (is_fields(shape) && is_fields(original) && is_fields(written)) {
        return entry_from_form(original, is_fields(seen) ? seen : {}, written, shape);
    }
    if (Array.isArray(original) && Array.isArray(seen) && Array.isArray(written) && (original.length === seen.length)) {
        return written.map(v => item_from_form(original, seen, v));
    }
    return written;
}

function item_from_form(original, seen, item)
{
    const at = seen.findIndex(v => is_same(v, item));
    return (at === -1) ? item : original[at];
}

// The other spelling of a key the form wrote or emptied goes with it
function twin_drop(changed, shape, key)
{
    if (typeof shape[key] === 'string') {
        delete changed[shape[key]];
    }
}

// An object of the config, as apart from a list and from null
function is_fields(value)
{
    return (value !== null) && (typeof value === 'object') && (Array.isArray(value) === false);
}

// Whether two values of a config say the same: the same keys and items with the same values
function is_same(value, other)
{
    if ((value === null) || (other === null) || (typeof value !== 'object') || (typeof other !== 'object')) {
        return value === other;
    }
    const keys = Object.keys(value);
    return (Array.isArray(value) === Array.isArray(other)) && (keys.length === Object.keys(other).length) && keys.every(v => is_same(value[v], other[v]));
}

export default entry_from_form;
