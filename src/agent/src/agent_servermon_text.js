const fs = require('fs');
const path = require('path');

// servermon.js as text, for the agent to write out beside itself. Read from src/servermon when
// the agent runs from the repo; the bundler writes the text itself into the bundled agent.
const agent_servermon_text = fs.readFileSync(path.join(__dirname, '..', '..', 'servermon', 'servermon.js'), 'utf8');

module.exports = agent_servermon_text;
