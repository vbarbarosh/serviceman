const agent_dir = require('./agent_dir');
const path = require('path');

// Where the agent writes down the programs it started and what they print: a folder of its
// own, beside the doors, that outlives this process
function agent_programs_dir()
{
    return path.join(agent_dir(), 'programs');
}

module.exports = agent_programs_dir;
