const agent_part_path = require('./agent_part_path');
const fs = require('fs');

// How much of a file being copied in parts is here: what the next part starts from. It is
// asked of the part itself, never through a link under that name: the size of what such a
// link points at would tell whether a file outside the caller's folders is there, and how big
async function agent_file_part_stat(params)
{
    const where = agent_part_path(params);
    try {
        const part = await fs.promises.lstat(where.part);
        return {received: part.isFile() ? part.size : 0};
    }
    catch {
        return {received: 0};
    }
}

module.exports = agent_file_part_stat;
