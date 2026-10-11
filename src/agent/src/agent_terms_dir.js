const agent_dir = require('./agent_dir');
const path = require('path');

// Where the terminals kept on this machine live: each one's socket, its size and a note of who
// holds it, beside the agent's other folders
function agent_terms_dir()
{
    return path.join(agent_dir(), 'terminals');
}

module.exports = agent_terms_dir;
