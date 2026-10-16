const agent_fs_path = require('./agent_fs_path');
const fs = require('fs');

// A bind mount whose folder is missing would be made by docker as root; the agent makes it
// first. A folder of the File Manager is made the same way, with every folder above it: one
// written without a root is under this machine's home, as for every other file it is asked for.
async function agent_dir_create(dir, root)
{
    const full = agent_fs_path(dir, root);
    if (fs.existsSync(full)) {
        return {created: false};
    }
    await fs.promises.mkdir(full, {recursive: true});
    return {created: true};
}

module.exports = agent_dir_create;
