const agent_fs_path = require('./agent_fs_path');
const fs = require('fs');

// One name carried to another — another folder included, which is what moving is. The same
// disk carries it in one step; another disk refuses, and the refusal is the answer.
async function agent_fs_rename(params)
{
    await fs.promises.rename(agent_fs_path(params.from), agent_fs_path(params.to));
    return {};
}

module.exports = agent_fs_rename;
