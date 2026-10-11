const agent_fs_path = require('./agent_fs_path');
const path = require('path');

// What a file may land under: a name of its own, and nothing that walks out of the folder
const RE_NAME = /^[^/\\]+$/;
// The id the page drew for one upload: letters and digits, long enough not to meet another
const RE_ID = /^[a-z0-9]{8,64}$/;

// Where the parts of one upload gather until the last is in: beside the file they will become,
// on the same disk, so the rename that finishes them is one step. A dot name, so a folder
// listing hides it with the other dot files.
function agent_part_path(target)
{
    const name = String((target.name === undefined) ? '' : target.name);
    const id = String((target.id === undefined) ? '' : target.id);
    if ((RE_NAME.test(name) === false) || (name === '.') || (name === '..')) {
        throw new Error(`a file lands under a name of its own, and ${JSON.stringify(name)} is not one`);
    }
    if (RE_ID.test(id) === false) {
        throw new Error(`an upload is named by letters and digits, and ${JSON.stringify(id)} is not that`);
    }
    const dir = agent_fs_path((target.dir === undefined) ? '~' : target.dir);
    return {dir, full: path.join(dir, name), part: path.join(dir, `.${name}.${id}.part`)};
}

module.exports = agent_part_path;
