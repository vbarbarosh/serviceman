const agent_fs_path = require('./agent_fs_path');
const fs = require('fs');

// One name, weighed before it is served: folder or file, how big, how old
async function agent_fs_stat(params)
{
    const stat = await fs.promises.stat(agent_fs_path(params.path));
    return {kind: (stat.isDirectory() ? 'dir' : 'file'), size: stat.size, mtime_ms: Math.round(stat.mtimeMs)};
}

module.exports = agent_fs_stat;
