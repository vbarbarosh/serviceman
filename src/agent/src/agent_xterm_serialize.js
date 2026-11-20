// What turns a terminal's screen and the lines above it into the bytes that draw them again
// (agent_term_keeper). The agent's one file carries the package's own code in place of this
// module (agent_bundle).
module.exports = require('@xterm/addon-serialize');
