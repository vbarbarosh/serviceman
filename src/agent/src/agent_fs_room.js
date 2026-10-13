const agent_fs_path = require('./agent_fs_path');
const fs = require('fs');
const path = require('path');

// The room left on the disk a folder is on, or will be on once made: free bytes, and free
// inodes, null on a filesystem that counts none (btrfs says 0 of 0)
async function agent_fs_room(params)
{
    let at = agent_fs_path(params.path);
    while ((fs.existsSync(at) === false) && (at !== path.dirname(at))) {
        at = path.dirname(at);
    }
    const stat = fs.statfsSync(at);
    return {bytes_free: stat.bavail*stat.bsize, inodes_free: ((stat.files === 0) ? null : stat.ffree)};
}

module.exports = agent_fs_room;
