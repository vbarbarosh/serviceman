const agent_addresses = require('../../agent/src/agent_addresses');
const os = require('os');

// What the page says about this computer: its name, the user the modules act as, its cores
// (the processes' CPU is a share of them all), and its addresses for how far a port reaches
function machine_read()
{
    return {hostname: os.hostname(), user: os.userInfo().username, cores: Math.max(1, os.cpus().length), addresses: agent_addresses()};
}

module.exports = machine_read;
