const data_browser_manifest = require('../../../../modules/data_browser/server/data_browser_manifest');
const disks_manifest = require('../../../../modules/disks/server/disks_manifest');
const docker_manifest = require('../../../../modules/docker/server/docker_manifest');
const file_manager_manifest = require('../../../../modules/file_manager/server/file_manager_manifest');
const file_manager_transfers_manifest = require('../../../../modules/file_manager/server/file_manager_transfers_manifest');
const firewall_manifest = require('../../../../modules/firewall/server/firewall_manifest');
const packages_manifest = require('../../../../modules/packages/server/packages_manifest');
const processes_manifest = require('../../../../modules/processes/server/processes_manifest');
const route_param = require('./route_param');
const terminal_manifest = require('../../../../modules/terminal/server/terminal_manifest');
const volumes_manifest = require('../../../../modules/volumes/server/volumes_manifest');
const vulnerabilities_manifest = require('../../../../modules/vulnerabilities/server/vulnerabilities_manifest');

// Where serviceman mounts each module's API: a machine's at /api/v1/remotes/<name>/<mount>, a
// database's data at /api/v1/databases/<server>/<database>/browse, the copies between machines
// once, at /api/v1/transfers. What each one holds and does is its
// manifest, by which every request to it is routed (module_route) and every right a token may
// have of it is found (control_route_right).
const MODULE_MOUNTS = mounts_with_re([
    {base: '/api/v1/remotes/<name>/processes', manifest: processes_manifest},
    {base: '/api/v1/remotes/<name>/disks', manifest: disks_manifest},
    {base: '/api/v1/remotes/<name>/packages', manifest: packages_manifest},
    {base: '/api/v1/remotes/<name>/docker', manifest: docker_manifest},
    {base: '/api/v1/remotes/<name>/firewall', manifest: firewall_manifest},
    {base: '/api/v1/remotes/<name>/volumes', manifest: volumes_manifest},
    {base: '/api/v1/remotes/<name>/vulnerabilities', manifest: vulnerabilities_manifest},
    {base: '/api/v1/remotes/<name>/fs', manifest: file_manager_manifest},
    {base: '/api/v1/remotes/<name>/terminals', manifest: terminal_manifest},
    {base: '/api/v1/transfers', manifest: file_manager_transfers_manifest},
    {base: '/api/v1/databases/<server>/<database>/browse', manifest: data_browser_manifest},
]);

// The mount a path is under, {mount, remote, params, tail}: params the words of its base, the
// machine's <name> among them as remote, null for one of no machine; null when it is under none
function module_mount_of(pathname)
{
    for (const mount of MODULE_MOUNTS) {
        const found = mount.re.exec(pathname);
        if (found === null) {
            continue;
        }
        const params = {};
        for (let i = 0; i < mount.params.length; i++) {
            params[mount.params[i]] = route_param(found[i + 1]);
        }
        const tail = found[mount.params.length + 1];
        return {mount, remote: (params.name === undefined) ? null : params.name, params, tail: (tail === undefined) ? '' : tail};
    }
    return null;
}

// Each base as the pattern of the paths under it, each of its <words> a group, in order
function mounts_with_re(mounts)
{
    return mounts.map(v => Object.assign({re: new RegExp(`^${v.base.replace(/<\w+>/g, '([^/]+)')}(\\/.*)?$`), params: Array.from(v.base.matchAll(/<(\w+)>/g), vv => vv[1])}, v));
}

module_mount_of.MODULE_MOUNTS = MODULE_MOUNTS;

module.exports = module_mount_of;
