const agent_root_ask = require('./agent_root_ask');

// Work that wants root: the root half of this machine does it when there is one, and what is
// given here is done in this session when there is not — with sudo in front of it, and sudo
// with nobody to answer it says so. A machine either has the root agent or it does not, and
// the difference is not the work's to hide. `otherwise` is told why: a root half that is there
// but older than the work (`root_old`) is not a machine without one.
async function agent_root_or(options, method, params, say, otherwise)
{
    try {
        return await agent_root_ask(options, method, params, say);
    }
    catch (error) {
        if (error.code !== 'NOROOT') {
            throw error;
        }
        return await otherwise(error);
    }
}

module.exports = agent_root_or;
