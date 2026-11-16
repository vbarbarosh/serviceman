const agent_dir = require('./agent_dir');
const agent_fs_path = require('./agent_fs_path');
const fs = require('fs');
const path = require('path');

// A folder a service keeps is written by its container as whatever user its image runs as,
// seldom the agent's own (authwall runs as node): it is open to every user, and the agent's
// data/ above it is the agent's alone, so only the container, through its mount, and the agent
// reach it
const KEPT_MODE = 0o777;
const DATA_MODE = 0o700;

// A bind mount whose folder is missing would be made by docker as root; the agent makes it
// first. A folder of the File Manager is made the same way, with every folder above it: one
// written without a root is under this machine's home, as for every other file it is asked for.
// `kept`: the folder is a service's own storage, opened to its container each time it starts.
async function agent_dir_create(dir, root, kept)
{
    const full = agent_fs_path(dir, root);
    const out = await dir_made(full);
    // Opened whether it was made now or before: a folder made by an agent before this one is
    // the agent's own and shut to its container
    if (kept === true) {
        kept_open(full);
    }
    return out;
}

// A path that is there already, a folder or a file a volume mounts, is left as it is
async function dir_made(full)
{
    if (fs.existsSync(full)) {
        return {created: false};
    }
    await fs.promises.mkdir(full, {recursive: true});
    return {created: true};
}

// A folder made before by someone else (docker, as root) is not the agent's to change: it is
// left as it is, as it was already written by its container
function kept_open(full)
{
    const data = path.join(agent_dir(), 'data');
    try {
        if (full.startsWith(`${data}${path.sep}`)) {
            fs.chmodSync(data, DATA_MODE);
        }
        fs.chmodSync(full, KEPT_MODE);
    }
    catch (error) {
        if (error.code !== 'EPERM') {
            throw error;
        }
    }
}

module.exports = agent_dir_create;
