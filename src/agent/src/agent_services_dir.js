const agent_dir = require('./agent_dir');
const path = require('path');

// Where everything the host asks this machine to install goes: one folder under the agent, so
// that taking the agent away takes its work with it and nothing is left anywhere else.
function agent_services_dir()
{
    if (process.env.SERVICEMAN_SERVICES_DIR) {
        return path.resolve(process.env.SERVICEMAN_SERVICES_DIR);
    }
    return path.join(agent_dir(), 'services');
}

module.exports = agent_services_dir;
