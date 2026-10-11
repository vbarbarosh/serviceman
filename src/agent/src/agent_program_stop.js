const agent_say = require('./agent_say');
const format_seconds = require('../../helpers/format_seconds');
const program_kill = require('../../helpers/program_kill');

// Stops what agent_program_start started: the whole group, asked first and made to go after.
// The wait is for the group — the process this agent started is only the first of a chain, and
// it is the last of the chain that holds the port.
async function agent_program_stop(state, params, group)
{
    const key = `${params.name}#${params.slot}`;
    const found = state.programs[key];
    if (found === undefined) {
        return {stopped: false};
    }
    delete state.programs[key];
    const ended = await program_kill(found.pid, (((params.grace_ms === null) || (params.grace_ms === undefined)) ? undefined : params.grace_ms));
    if (ended.killed) {
        agent_say(group, 'program_killed', `${format_seconds(ended.waited_ms)} service=${params.name} pid=${found.pid} note="it was asked to stop and did not"`);
    }
    return {stopped: true, killed: ended.killed};
}

module.exports = agent_program_stop;
