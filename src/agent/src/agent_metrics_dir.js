const agent_dir = require('./agent_dir');
const path = require('path');

// Where the machine keeps its own numbers: a file a day of a line every half minute, and a file
// a day of five-minute averages
function agent_metrics_dir()
{
    return path.join(agent_dir(), 'metrics');
}

module.exports = agent_metrics_dir;
