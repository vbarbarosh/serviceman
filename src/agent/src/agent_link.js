// The link this agent is talking on, while it has one. Everything the agent says goes to its
// own log and — when there is a link — to the host as well, so what happens on this machine is
// readable on the page that asked for it. A machine with no link keeps writing its own file.
const held = {socket: null};

function agent_link(socket)
{
    if (socket !== undefined) {
        held.socket = socket;
    }
    return held.socket;
}

module.exports = agent_link;
