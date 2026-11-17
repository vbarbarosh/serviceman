const agent_doors_path = require('./agent_doors_path');
const agent_doors_state = require('./agent_doors_state');
const agent_local_serve = require('./agent_local_serve');
const file_write_synced = require('./file_write_synced');

// A new door table from serviceman: on disk first, whole or not at all, and only then what the
// door routes by. It holds the tokens the machines ask each other with, so nobody else reads it.
function agent_doors_set(table)
{
    file_write_synced(agent_doors_path(), JSON.stringify(table, null, 4), 0o600);
    agent_doors_state.table = table;
    // A board published here, or taken off, opens or closes its port on the loopback
    agent_local_serve.apply();
    return {version: table.version};
}

module.exports = agent_doors_set;
