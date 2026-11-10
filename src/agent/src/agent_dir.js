const fs = require('fs');
const path = require('path');

// The folder the agent lives in: its logs, and the services it was asked to install. The
// installer writes it down; a hand-run agent takes the folder its own file sits in —
// `node serviceman-agent.js` names a file in it. `node src/agent` is the repository itself,
// and so is `node src/agent/index.js`: what the agent writes down, its door table, its
// programs, its logs, goes under the repository's `data/`, which git ignores, never into `src/`.
function agent_dir()
{
    if (process.env.SERVICEMAN_AGENT_DIR) {
        return path.resolve(process.env.SERVICEMAN_AGENT_DIR);
    }
    const own = path.resolve((process.argv[1] === undefined) ? '.' : process.argv[1]);
    if (fs.existsSync(own) && fs.statSync(own).isDirectory()) {
        return path.join(own, '..', '..', 'data', 'agent');
    }
    // The repository's agent named by its file: the bundle is one file with nothing of its own
    // beside it, and this index.js has the agent's sources, this file among them, in src/
    if ((path.basename(own) === 'index.js') && fs.existsSync(path.join(path.dirname(own), 'src', 'agent_dir.js'))) {
        return path.join(path.dirname(own), '..', '..', 'data', 'agent');
    }
    return path.dirname(own);
}

module.exports = agent_dir;
