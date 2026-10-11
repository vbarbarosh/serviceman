const agent_part_path = require('./agent_part_path');
const fs = require('fs');

// An upload given up: what came of it goes, and the file it was meant to be is left alone
async function agent_file_part_remove(params)
{
    fs.rmSync(agent_part_path(params).part, {force: true});
    return {};
}

module.exports = agent_file_part_remove;
