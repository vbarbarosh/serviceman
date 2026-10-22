// Which door of a module a request is, by the module's manifest: one of its kinds read or made,
// a command on all of a kind or on one item, or one of the doors that are neither (a stream,
// another module's API inside this one). null for anything the manifest does not name, which
// the host answers 404 before the module is asked.
//
//     GET  <base>[/<kind>]                  the kind read: its items, or the thing itself
//     POST <base>[/<kind>]                  an item made: the command create
//     POST <base>[/<kind>]/<command>        a command on all of the kind
//     GET  <base>[/<kind>]/<command>        how a long command's run goes (answer: run)
//     POST <base>[/<kind>]/<id>/<command>   a command on one item
//
// The kind is left out for the module's own one, kind ''. HEAD is taken as GET. The answer is
// {kind, id, command, door, right}: command 'read' for a read, 'run' for a run read back, and
// right the one a token needs for it, null for one only the owner has.
function module_route(manifest, method, tail)
{
    const verb = (method === 'HEAD') ? 'GET' : method;
    const path = (tail === '/') ? '' : tail;
    if ((path !== '') && (path[0] !== '/')) {
        return null;
    }
    for (const door of manifest.doors) {
        if (door.methods.includes(verb) && new RegExp(door.re).test(path)) {
            return route_found(manifest, null, null, null, door.door, door.right);
        }
    }
    const words = (path === '') ? [] : path.slice(1).split('/');
    let kind = manifest.kinds.find(v => (v.kind !== '') && (v.kind === words[0]));
    let rest = words.slice(1);
    if (kind === undefined) {
        kind = manifest.kinds.find(v => v.kind === '');
        rest = words;
    }
    if ((kind === undefined) || rest.includes('')) {
        return null;
    }
    if (rest.length === 0) {
        if ((verb === 'GET') && (kind.read !== undefined)) {
            return route_found(manifest, kind, null, 'read', null, kind.read.right);
        }
        const create = kind.commands.find(v => v.command === 'create');
        if ((verb === 'POST') && (create !== undefined)) {
            return route_found(manifest, kind, null, 'create', null, create.right);
        }
        return null;
    }
    if (rest.length === 1) {
        const command = kind.commands.find(v => (v.on === 'kind') && (v.command === rest[0]) && (v.command !== 'create'));
        if ((command !== undefined) && (verb === 'POST')) {
            return route_found(manifest, kind, null, command.command, null, command.right);
        }
        if ((command !== undefined) && (verb === 'GET') && (command.answer === 'run')) {
            return route_found(manifest, kind, null, 'run', null, command.right);
        }
        return null;
    }
    if (rest.length === 2) {
        const command = kind.commands.find(v => (v.on === 'item') && (v.command === rest[1]));
        if ((command === undefined) || (verb !== 'POST')) {
            return null;
        }
        const id = id_decoded(rest[0]);
        if ((id === null) || (new RegExp(`^(?:${kind.id})$`).test(id) === false)) {
            return null;
        }
        return route_found(manifest, kind, id, command.command, null, command.right);
    }
    return null;
}

// A right given to the whole module covers every door of it
function route_found(manifest, kind, id, command, door, right)
{
    const given = (manifest.right === undefined) ? right : manifest.right;
    return {kind: (kind === null) ? null : kind.kind, id, command, door, right: (given === undefined) ? null : given};
}

function id_decoded(text)
{
    try {
        return decodeURIComponent(text);
    }
    catch {
        return null;
    }
}

module.exports = module_route;
