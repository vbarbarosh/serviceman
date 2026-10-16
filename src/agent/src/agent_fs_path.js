const fs = require('fs');
const os = require('os');
const path = require('path');

// Where a path the host names is on this machine. ~ is the home of the user the agent runs
// as, and a path written without a root is under it — the reading a person sitting at this
// machine would give it.
//
// With `root`, the folders a token of the host is kept within (one, or a list), the path must
// be in one of them: one written without a root, or none at all, is under the first, and
// whatever it names, through links too, must lie inside one of them, or it is refused as
// EACCES. A folder need not be there yet: what is written into it makes it. The answer is the
// path as asked, never the one its links lead to, so a link is renamed or deleted as itself.
function agent_fs_path(text, root)
{
    const asked = String(((text === undefined) || (text === null)) ? '' : text);
    const roots = (Array.isArray(root) ? root : [root]).filter(v => ((typeof v === 'string') && (v !== '')));
    if (roots.length === 0) {
        return plain((asked === '') ? '~' : asked);
    }
    const first = plain(roots[0]);
    let full;
    if ((asked === '') || (asked === '~')) {
        full = first;
    }
    else if (path.isAbsolute(asked) || asked.startsWith('~/')) {
        full = plain(asked);
    }
    else {
        full = path.resolve(first, asked);
    }
    const seen = real_of_nearest(full);
    const inside = roots.map(v => real_of_nearest(plain(v))).some(v => ((seen === v) || seen.startsWith(`${v}${path.sep}`)));
    if (inside === false) {
        throw Object.assign(new Error(`EACCES: ${JSON.stringify(asked)} is outside the folders this token may use`), {code: 'EACCES'});
    }
    return full;
}

function plain(asked)
{
    if ((asked === '~') || asked.startsWith('~/')) {
        return path.join(os.homedir(), asked.slice(1));
    }
    return path.resolve(os.homedir(), asked);
}

// Where a path really is: its nearest part that is there, through its links, and the rest of it
// as written — so a file not made yet is judged by the folder it would be made in
function real_of_nearest(full)
{
    let there = full;
    const rest = [];
    while (fs.lstatSync(there, {throwIfNoEntry: false}) === undefined) {
        const up = path.dirname(there);
        if (up === there) {
            break;
        }
        rest.unshift(path.basename(there));
        there = up;
    }
    let real = there;
    try {
        real = fs.realpathSync(there);
    }
    catch {
        // A link that leads nowhere is judged by where it says it leads
        if (fs.lstatSync(there).isSymbolicLink()) {
            real = path.resolve(path.dirname(there), fs.readlinkSync(there));
        }
    }
    return path.join(real, ...rest);
}

module.exports = agent_fs_path;
