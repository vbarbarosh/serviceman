const agent_doors_path = require('./agent_doors_path');
const fs = require('fs');

// The door table this machine was last told, or null when it was never told one. It is read
// at start, so a machine that comes up while serviceman is away serves what it served before.
function agent_doors_read()
{
    try {
        return JSON.parse(fs.readFileSync(agent_doors_path(), 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

module.exports = agent_doors_read;
