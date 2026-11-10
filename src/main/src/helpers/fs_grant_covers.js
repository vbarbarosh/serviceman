const path = require('path');

// Whether a grant opens this path of this machine: the file it names, or whatever is in the
// folder it names. The path is taken as the machine will read it, its `..` resolved first.
function fs_grant_covers(grant, remote_name, asked)
{
    if (grant.remote !== remote_name) {
        return false;
    }
    const full = path.posix.normalize(asked);
    if (grant.kind === 'file') {
        return full === grant.path;
    }
    return full.startsWith(`${grant.path}/`);
}

module.exports = fs_grant_covers;
