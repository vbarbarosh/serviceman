// The terminal with no screen the keeper draws into (agent_term_keeper). The agent's one file
// carries the package's own code in place of this module (agent_bundle), so a machine needs no
// npm install for it.
module.exports = require('@xterm/headless');
