const os = require('os');
const path = require('path');

// `~/` is the home of the user this agent runs as: the one part of a path serviceman cannot
// write out for a machine it does not log in to
function agent_path_expand(file)
{
    if (file.startsWith('~/')) {
        return path.join(os.homedir(), file.slice(2));
    }
    return file;
}

module.exports = agent_path_expand;
