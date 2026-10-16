const agent_fs_path = require('./agent_fs_path');
const fs = require('fs');
const path = require('path');

// A link made the way it was where it came from: the same target text, never followed. A
// link already there with that target is made already; any other name there is left alone.
//
//     params = {path, target}
async function agent_link_create(params)
{
    const full = agent_fs_path(String(params.path));
    const target = String(params.target);
    if (target === '') {
        throw new Error('a link points somewhere, and its target is empty');
    }
    const there = fs.lstatSync(full, {throwIfNoEntry: false});
    if (there !== undefined) {
        if (there.isSymbolicLink() && (fs.readlinkSync(full) === target)) {
            return {created: false};
        }
        throw new Error(`${path.basename(full)} is there already, and is not that link`);
    }
    fs.mkdirSync(path.dirname(full), {recursive: true});
    fs.symlinkSync(target, full);
    return {created: true};
}

module.exports = agent_link_create;
