const agent_dir = require('./agent_dir');
const agent_token_read = require('./agent_token_read');
const fs = require('fs');
const path = require('path');

// The token this machine kept, set aside when it is the one the host has just refused as
// "removed": the host has no machine for it any more, and an agent started again in this folder
// would dial with it first and be told the same. It is renamed, not deleted, so the next start
// dials with the token the agent is started with: the join token joins the machine again, the
// token of a new entry takes it. Answers with the name it has now, or null when the token
// refused is not one this machine kept.
function agent_token_set_aside(token)
{
    if (agent_token_read() !== token) {
        return null;
    }
    const file = path.join(agent_dir(), agent_token_read.FILE);
    try {
        fs.renameSync(file, `${file}.removed`);
        return `${agent_token_read.FILE}.removed`;
    }
    catch {
        // A folder that cannot be written keeps it where it is; the agent stops all the same
        return null;
    }
}

module.exports = agent_token_set_aside;
