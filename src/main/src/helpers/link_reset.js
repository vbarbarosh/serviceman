const link_send_message = require('../../../helpers/link_send_message');
const log_event = require('./log_event');

// A link let go at once, the way to the machine being what stands: the `bye` goes in case it
// still gets through, and the socket is reset rather than closed, since a close is one more
// thing in line behind the bytes that do not move. The agent hears the reset, or its own
// silence, and dials in again on a link of its own.
function link_reset(app, remote, reason, words)
{
    const socket = remote.state.socket;
    if (socket === null) {
        return;
    }
    log_event(app, 'remote_dropped', Object.assign({remote: remote.name, reason}, words, {then: 'its agent dials in again'}));
    try {
        link_send_message(socket, {type: 'bye', reason});
    }
    catch {
        // The link is already going; the reset below is what matters
    }
    if (typeof socket.resetAndDestroy === 'function') {
        socket.resetAndDestroy();
        return;
    }
    socket.destroy();
}

module.exports = link_reset;
