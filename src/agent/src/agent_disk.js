const agent_shell = require('./agent_shell');

const BLOCK_BYTES = 1024;
// A df that hangs on a dead mount must not hold the hello: no numbers, rather than no link
const DF_SAY_MS = 3000;

// How much room is left where the services will live
async function agent_disk(dir)
{
    const answer = await agent_shell(['df', '-kP', dir], {timeout: DF_SAY_MS});
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
