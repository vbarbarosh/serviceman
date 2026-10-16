const agent_fs_path = require('./agent_fs_path');
const fs = require('fs');
const path = require('path');

// One folder of this machine, read as the agent's own user: what that user may not open,
// this cannot show. Folders first, then files, each half by name. A folder of a token that is
// not there yet is an empty one: it is made when something is first written into it.
async function agent_fs_list(asked, root)
{
    const dir = agent_fs_path(asked, root);
    const roots = (Array.isArray(root) ? root : [root]).filter(v => ((typeof v === 'string') && (v !== ''))).map(v => agent_fs_path(v));
    if (roots.includes(dir) && (fs.existsSync(dir) === false)) {
        return {path: dir, items: []};
    }
    const found = await fs.promises.readdir(dir, {withFileTypes: true});
    const items = [];
    for (const entry of found) {
        const item = {name: entry.name, kind: (entry.isDirectory() ? 'dir' : 'file'), size: null, mtime_ms: null};
        // The stat follows a link, so a link to a folder opens like one; a name that cannot
        // be read stays in the list with nothing said about it
        try {
            const stat = await fs.promises.stat(path.join(dir, entry.name));
            item.kind = (stat.isDirectory() ? 'dir' : 'file');
            item.size = (stat.isFile() ? stat.size : null);
            item.mtime_ms = Math.round(stat.mtimeMs);
        }
        catch {
        }
        items.push(item);
    }
    items.sort((a, b) => ((a.kind === b.kind) ? a.name.localeCompare(b.name) : ((a.kind === 'dir') ? -1 : 1)));
    return {path: dir, items};
}

module.exports = agent_fs_list;
