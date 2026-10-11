const agent_root_ping = require('./agent_root_ping');

// Whether this machine has a root half the agent may ask. It is asked, not looked for: a
// socket file that nothing answers is a socket file, and the host is told what is true now.
async function agent_root_there(options)
{
    return (await agent_root_ping(options)) !== null;
}

module.exports = agent_root_there;
