const agent_root_ask = require('./agent_root_ask');

// What the root half of this machine says about itself, or null when there is none. It names
// the build it is running, because the file it was started from is replaced by an update
// while it goes on running the old one — and something has to notice.
async function agent_root_ping(options)
{
    try {
        return await agent_root_ask(options, 'ping', {});
    }
    catch {
        return null;
    }
}

module.exports = agent_root_ping;
