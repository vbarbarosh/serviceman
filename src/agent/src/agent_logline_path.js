const agent_dir = require('./agent_dir');
const path = require('path');

// Where the agent keeps what serviceman told it about Logline, and later the lines on their way
// there: a folder of its own, so no volume a service keeps under data/ can ever share a name
function agent_logline_path(name)
{
    return path.join(agent_dir(), 'logline', name);
}

module.exports = agent_logline_path;
