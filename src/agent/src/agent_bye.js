const agent_link = require('./agent_link');
const link_send_message = require('../../helpers/link_send_message');

// The machine says it is going, and why, before it goes. A host that is told does not have to
// work it out from silence — and silence is the one thing it cannot tell apart from a network
// that blinked. Said on the way to a shutdown, a stop, and a suspend.
function agent_bye(reason)
{
    const socket = agent_link();
    if ((socket === null) || (socket === undefined) || socket.destroyed) {
        return false;
    }
    try {
        link_send_message(socket, {type: 'bye', reason});
        // The link goes with it: a machine that has said goodbye and then sits there open is a
        // machine the host has to wait out anyway
        socket.end();
        return true;
    }
    catch {
        return false;
    }
}

module.exports = agent_bye;
