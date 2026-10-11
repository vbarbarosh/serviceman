const agent_fs_path = require('./agent_fs_path');
const fs = require('fs');
const os = require('os');

// A file or a whole folder, taken away for good. The home of the agent's user and the root
// of the disk are not things a file manager deletes.
async function agent_fs_delete(params)
{
    const full = agent_fs_path(params.path);
    if ((full === '/') || (full === os.homedir())) {
        throw new Error(`${full} is not a thing the File Manager deletes`);
    }
    await fs.promises.rm(full, {recursive: true});
    return {};
}

module.exports = agent_fs_delete;
