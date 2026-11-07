const fs = require('fs');
const os = require('os');
const os_from_release = require('./os_from_release');
const package_versions_from_status = require('./package_versions_from_status');
const path = require('path');

const OS_RELEASE = ['/etc/os-release', '/usr/lib/os-release'];
const DPKG_STATUS = '/var/lib/dpkg/status';

// What a machine runs, for the CVEs that hit it: its system and release, the kernel running
// now, and the version of every package dpkg says is installed, read from dpkg's own file, no
// program run. A machine with no dpkg says no packages, and the host says why it cannot tell.
//
//     -> {os: {id, version, name, codename} | null, kernel, packages: {name: version} | null}
function agent_package_versions(options)
{
    const base = (options.security_root_dir === undefined) ? '' : options.security_root_dir;
    const release = OS_RELEASE.map(v => path.join(base, v)).find(v => fs.existsSync(v));
    let packages = null;
    try {
        packages = package_versions_from_status(fs.readFileSync(path.join(base, DPKG_STATUS), 'utf8'));
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
    return {
        os: (release === undefined) ? null : os_from_release(fs.readFileSync(release, 'utf8')),
        kernel: (options.kernel_release === undefined) ? os.release() : options.kernel_release,
        packages,
    };
}

module.exports = agent_package_versions;
