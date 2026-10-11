const agent_addresses = require('../../agent/src/agent_addresses');
const os = require('os');

// What the page says about this computer: its name, and its addresses for how far a port reaches
function machine_read()
{
    return {hostname: os.hostname(), addresses: agent_addresses()};
}

module.exports = machine_read;
