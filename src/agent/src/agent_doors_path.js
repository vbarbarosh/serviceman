const agent_dir = require('./agent_dir');
const path = require('path');

// Where the agent keeps its door table: a folder of its own, beside Logline's
function agent_doors_path()
{
    return path.join(agent_dir(), 'doors', 'table.json');
}

module.exports = agent_doors_path;
