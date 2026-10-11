const agent_services_dir = require('./agent_services_dir');
const fs = require('fs');
const path = require('path');

// Takes away a folder the agent made for a program, and nothing else: the path has to be
// inside the agent's own services folder, and it cannot be that folder. serviceman only asks
// for folders it chose itself, and this is the second lock on the same door.
async function agent_program_remove(params)
{
    const root = agent_services_dir();
    const dir = path.resolve(root, ((params.cwd === null) || (params.cwd === undefined)) ? '.' : params.cwd);
    if ((dir === root) || (dir.startsWith(`${root}${path.sep}`) === false)) {
        throw new Error(`${dir} is not a folder this agent made`);
    }
    if (fs.existsSync(dir) === false) {
        return {removed: false};
    }
    await fs.promises.rm(dir, {recursive: true, force: true});
    return {removed: true};
}

module.exports = agent_program_remove;
