const fs = require('fs');
const path = require('path');

// The folder the agent lives in: its logs, and the services it was asked to install. The
// installer writes it down; a hand-run agent takes the folder its own file sits in —
// `node src/agent` names the folder itself, `node serviceman-agent.js` names a file in it.
function agent_dir()
{
    if (process.env.SERVICEMAN_AGENT_DIR) {
        return path.resolve(process.env.SERVICEMAN_AGENT_DIR);
    }
    const own = path.resolve((process.argv[1] === undefined) ? '.' : process.argv[1]);
    if (fs.existsSync(own) && fs.statSync(own).isDirectory()) {
        return own;
    }
    return path.dirname(own);
}

module.exports = agent_dir;
