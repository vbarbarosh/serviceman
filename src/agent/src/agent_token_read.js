const agent_dir = require('./agent_dir');
const fs = require('fs');
const path = require('path');

const FILE = 'token';

// The token of this machine's own, as the host handed it when the machine added itself with
// the join token: kept beside the agent, and dialled with from then on. Null when the machine
// never got one: it dials with what it was started with.
function agent_token_read()
{
    try {
        const token = fs.readFileSync(path.join(agent_dir(), FILE), 'utf8').trim();
        return (token === '') ? null : token;
    }
    catch {
        return null;
    }
}

agent_token_read.FILE = FILE;

module.exports = agent_token_read;
