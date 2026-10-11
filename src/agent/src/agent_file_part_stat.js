const agent_part_path = require('./agent_part_path');
const fs = require('fs');

// How much of a file being copied in parts is here: what the next part starts from
async function agent_file_part_stat(params)
{
    const where = agent_part_path(params);
    try {
        return {received: (await fs.promises.stat(where.part)).size};
    }
    catch {
        return {received: 0};
    }
}

module.exports = agent_file_part_stat;
