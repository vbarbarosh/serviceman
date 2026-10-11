const agent_shell = require('./agent_shell');

const BLOCK_BYTES = 1024;

// How much room is left where the services will live
async function agent_disk(dir)
{
    const answer = await agent_shell(['df', '-kP', dir]);
    const line = answer.stdout.split('\n')[1];
    if ((answer.ok === false) || (line === undefined)) {
        return {path: dir, total: null, free: null};
    }
    const columns = line.trim().split(/\s+/);
    return {
        path: dir,
        total: parseInt(columns[1], 10)*BLOCK_BYTES,
        free: parseInt(columns[3], 10)*BLOCK_BYTES,
    };
}

module.exports = agent_disk;
