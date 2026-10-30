const module_mount_of = require('./module_mount_of');
const module_route = require('./module_route');

// What a token other than the owner's may ask of the control door: these rights and nothing
// else, each of one machine but the status. Every other route is the owner's alone, a route
// added later included, until it is written here on purpose. The modules' rights are not
// here: each module's manifest names its own, door by door (module_mount_of).
//
//     right    its name, as a token holds it
//     said     what a refusal says the token may not do
//     methods  the methods it allows
//     re       the route, the machine's name its first group; a route of a service or of the
//              forwards names no machine here, and the route itself keeps the token to the
//              machines it sees
const RIGHTS = [
    {right: 'status', said: 'read the status', methods: ['GET', 'HEAD'], re: /^\/api\/v1\/status$/},
    {right: 'metrics', said: 'read the charts', methods: ['GET', 'HEAD'], re: /^\/api\/v1\/remotes\/([^/]+)\/metrics$/},
    {right: 'metrics', said: 'read the uptime', methods: ['GET', 'HEAD'], re: /^\/api\/v1\/remotes\/([^/]+)\/uptime$/},
    {right: 'ports', said: 'read the ports', methods: ['GET', 'HEAD'], re: /^\/api\/v1\/remotes\/([^/]+)\/ports$/},
    {right: 'versions', said: 'send a new version of an app', methods: ['PUT'], re: /^\/api\/v1\/services\/[^/]+\/zip$/},
    {right: 'forwards', said: 'read the forwards', methods: ['GET'], re: /^\/api\/v1\/forwards$/},
    {right: 'forwards', said: 'write the forwards', methods: ['PUT'], re: /^\/api\/v1\/forwards$/},
];

// The right a request needs, {right, said, remote}, remote null for one of no machine; null
// when it needs one no token but the owner's has
function control_route_right(method, pathname)
{
    for (const item of RIGHTS) {
        const found = item.re.exec(pathname);
        if ((found !== null) && item.methods.includes(method)) {
            return {right: item.right, said: item.said, remote: (found[1] === undefined) ? null : decodeURIComponent(found[1])};
        }
    }
    const mounted = module_mount_of(pathname);
    if (mounted === null) {
        return null;
    }
    // A right to the whole module is to every request under it; the module says what is a door
    const manifest = mounted.mount.manifest;
    const given = (manifest.right === undefined) ? module_route(manifest, method, mounted.tail) : {right: manifest.right};
    if ((given === null) || (given.right === null)) {
        return null;
    }
    return {right: given.right.right, said: given.right.said, remote: mounted.remote};
}

control_route_right.RIGHTS = Array.from(new Set(RIGHTS.map(v => v.right).concat(module_mount_of.MODULE_MOUNTS.flatMap(v => manifest_rights(v.manifest)))));

// Every right a manifest names, in its order
function manifest_rights(manifest)
{
    const kinds = manifest.kinds.flatMap(v => [(v.read === undefined) ? undefined : v.read.right].concat(v.commands.map(vv => vv.right)));
    const doors = manifest.doors.map(v => v.right);
    return [manifest.right].concat(kinds, doors).filter(v => v !== undefined).map(v => v.right);
}

module.exports = control_route_right;
