const agent_addresses = require('../../agent/src/agent_addresses');
const node_sqlite_refusal_of = require('../../helpers/node_sqlite_refusal_of');
const os = require('os');

// What the page says about this computer: its name, the user the modules act as, its cores
// (the processes' CPU is a share of them all), its addresses for how far a port reaches, and
// why its SQLite files are not read, null when they are: module-host's own Node reads them
function machine_read()
{
    return {hostname: os.hostname(), user: os.userInfo().username, cores: Math.max(1, os.cpus().length), addresses: agent_addresses(), sqlite_refusal: node_sqlite_refusal_of(process.version)};
}

module.exports = machine_read;
