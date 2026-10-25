const agent_dir = require('./agent_dir');
const agent_token_read = require('./agent_token_read');
const fs = require('fs');
const path = require('path');

const FILE_MODE = 0o600;

// The token the host handed this machine, written beside the agent for the agent's user alone
function agent_token_keep(token)
{
    const file = path.join(agent_dir(), agent_token_read.FILE);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(`${file}.new`, `${token}\n`, {mode: FILE_MODE});
    fs.chmodSync(`${file}.new`, FILE_MODE);
    fs.renameSync(`${file}.new`, file);
}

module.exports = agent_token_keep;
