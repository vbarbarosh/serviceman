const fs = require('fs');
const path = require('path');

// When the agent this host serves was made: the newest of the modules it is built from. The
// agent carries the same stamp inside it, so the two can be compared — that is how a machine
// running yesterday's agent is known to be running yesterday's agent.
function agent_built_at(files)
{
    let newest = 0;
    for (const file of files) {
        newest = Math.max(newest, fs.statSync(file).mtimeMs);
    }
    return new Date(newest).toISOString();
}

module.exports = agent_built_at;
