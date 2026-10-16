// What a token other than the owner's may ask of the control door: these rights and nothing
// else, each of one machine but the status. Every other route is the owner's alone, a route
// added later included, until it is written here on purpose.
//
//     right    its name, as a token holds it
//     said     what a refusal says the token may not do
//     methods  the methods it allows
//     re       the route, the machine's name its first group
const RIGHTS = [
    {right: 'status', said: 'read the status', methods: ['GET', 'HEAD'], re: /^\/api\/v1\/status$/},
    {right: 'metrics', said: 'read the charts', methods: ['GET', 'HEAD'], re: /^\/api\/v1\/remotes\/([^/]+)\/metrics$/},
    {right: 'processes', said: 'read the processes', methods: ['GET', 'HEAD'], re: /^\/api\/v1\/remotes\/([^/]+)\/processes$/},
    {right: 'ports', said: 'read the ports', methods: ['GET', 'HEAD'], re: /^\/api\/v1\/remotes\/([^/]+)\/ports$/},
    {right: 'disks', said: 'read the disks', methods: ['GET', 'HEAD'], re: /^\/api\/v1\/remotes\/([^/]+)\/disks$/},
    {right: 'packages', said: 'read the packages', methods: ['GET', 'HEAD'], re: /^\/api\/v1\/remotes\/([^/]+)\/packages$/},
    {right: 'containers', said: 'read the containers', methods: ['GET', 'HEAD'], re: /^\/api\/v1\/remotes\/([^/]+)\/docker\/containers$/},
    // The file manager of its machine, kept within the token's folder by the agent itself
    {right: 'files', said: 'use the files', methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'], re: /^\/api\/v1\/remotes\/([^/]+)\/fs(?:\/.*)?$/},
    // A kept terminal is a shell on its machine: listed, made, signalled, ended here, and
    // joined through the shell door (handle_control_upgrade)
    {right: 'terminals', said: 'use the terminals', methods: ['GET', 'HEAD', 'POST'], re: /^\/api\/v1\/remotes\/([^/]+)\/terminals$/},
    {right: 'terminals', said: 'use the terminals', methods: ['POST'], re: /^\/api\/v1\/remotes\/([^/]+)\/terminals\/[^/]+\/(?:end|signal)$/},
];

// The right a request needs, {right, said, remote}, remote null for one of no machine; null
// when it needs one no token but the owner's has
function control_route_right(method, pathname)
{
    for (const item of RIGHTS) {
        const found = item.re.exec(pathname);
        if ((found !== null) && item.methods.includes(method)) {
            return {right: item.right, said: item.said, remote: ((found[1] === undefined) ? null : decodeURIComponent(found[1]))};
        }
    }
    return null;
}

control_route_right.RIGHTS = Array.from(new Set(RIGHTS.map(v => v.right)));

module.exports = control_route_right;
