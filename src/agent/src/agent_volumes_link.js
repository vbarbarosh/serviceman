const agent_dir = require('./agent_dir');
const agent_volumes_dir = require('./agent_volumes_dir');
const fs = require('fs');
const path = require('path');

// `<agent folder>/volumes`, a link to where the volume files are, once there are any. The files
// stay where they are: an rm -rf of the agent's folder removes the link, never a volume.
function agent_volumes_link(options, folder)
{
    const target = agent_volumes_dir(options);
    const link = path.join(((folder === undefined) ? agent_dir() : folder), 'volumes');
    try {
        if (fs.existsSync(target) && (fs.lstatSync(link, {throwIfNoEntry: false}) === undefined)) {
            fs.symlinkSync(target, link);
        }
    }
    catch {
        // A convenience only: a folder it may not write in leaves the volumes as they are
    }
}

module.exports = agent_volumes_link;
