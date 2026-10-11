const os = require('os');
const path = require('path');

// Where a path the host names is on this machine. ~ is the home of the user the agent runs
// as, and a path written without a root is under it — the reading a person sitting at this
// machine would give it.
function agent_fs_path(text)
{
    const asked = String(((text === undefined) || (text === null) || (text === '')) ? '~' : text);
    if ((asked === '~') || asked.startsWith('~/')) {
        return path.join(os.homedir(), asked.slice(1));
    }
    return path.resolve(os.homedir(), asked);
}

module.exports = agent_fs_path;
