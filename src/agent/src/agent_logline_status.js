const agent_logline = require('./agent_logline');

// How this machine's lines are faring, for the host's Logs tab: how many went, how many wait
// here, how old the oldest waiting one is, and what Logline said last
function agent_logline_status()
{
    return agent_logline.status();
}

module.exports = agent_logline_status;
