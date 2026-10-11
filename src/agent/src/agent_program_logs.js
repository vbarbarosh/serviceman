// What a program running here has said, for the Logs button on the host: its last lines, read
// back from its files when an agent before this one started it
function agent_program_logs(state, params)
{
    const found = state.programs[`${params.name}#${params.slot}`];
    if (found === undefined) {
        return {text: ''};
    }
    return {text: found.output.join('\n')};
}

module.exports = agent_program_logs;
