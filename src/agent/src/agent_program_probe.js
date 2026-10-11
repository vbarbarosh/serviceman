// Is the program still running here? What an agent before this one started is known too: it
// was written down, and taken back when this agent began (agent_programs_adopt).
function agent_program_probe(state, params)
{
    const found = state.programs[`${params.name}#${params.slot}`];
    if (found === undefined) {
        return {running: false, pid: null};
    }
    return {running: true, pid: found.pid};
}

module.exports = agent_program_probe;
