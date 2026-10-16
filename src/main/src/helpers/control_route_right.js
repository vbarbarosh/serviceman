// What a reader's token may ask of the control door: these reads and nothing else, each a GET
// of one machine but the status. Every other route is the owner's alone, a route added later
// included, until it is written here on purpose.
const READS = [
    {read: 'status', re: /^\/api\/v1\/status$/},
    {read: 'metrics', re: /^\/api\/v1\/remotes\/([^/]+)\/metrics$/},
    {read: 'processes', re: /^\/api\/v1\/remotes\/([^/]+)\/processes$/},
    {read: 'ports', re: /^\/api\/v1\/remotes\/([^/]+)\/ports$/},
    {read: 'disks', re: /^\/api\/v1\/remotes\/([^/]+)\/disks$/},
    {read: 'packages', re: /^\/api\/v1\/remotes\/([^/]+)\/packages$/},
    {read: 'containers', re: /^\/api\/v1\/remotes\/([^/]+)\/docker\/containers$/},
];

// The read a request is, {read, remote}, remote null for one of no machine; null when it is
// none of them, which only the owner may ask
function control_route_right(method, pathname)
{
    if ((method !== 'GET') && (method !== 'HEAD')) {
        return null;
    }
    for (const item of READS) {
        const found = item.re.exec(pathname);
        if (found !== null) {
            return {read: item.read, remote: ((found[1] === undefined) ? null : decodeURIComponent(found[1]))};
        }
    }
    return null;
}

control_route_right.READS = READS.map(v => v.read);

module.exports = control_route_right;
