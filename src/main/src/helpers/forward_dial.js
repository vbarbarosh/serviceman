// A forward's `from`, as an agent dials it: a socket file, or a port on its loopback or at an
// address it reaches. The agent of the machine it shows up on, when both ends are that
// machine's (forwards_tell); the agent of the machine the service is on, when a peer asks it
// for the forward (doors_table).
function forward_dial(from)
{
    if (from.socket !== null) {
        return {path: from.socket};
    }
    return (from.host === null) ? {port: from.port} : {host: from.host, port: from.port};
}

module.exports = forward_dial;
