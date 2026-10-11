const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

// Did this request come from the machine serviceman runs on? Everything it is trusted with —
// the control page, the reason a service failed — hangs on this one question.
//
// A connection over a socket file has no address at all: whoever opened it had to be able to
// open that file, which is the same question asked by the filesystem.
function from_this_machine(req)
{
    // Except one that came in through a machine's link: it has no address either, and whoever
    // opened it is on the far side of that agent — the public, where an http socket is served
    if (req.socket.tunnel_from !== undefined) {
        return false;
    }
    if (req.socket.remoteAddress === undefined) {
        return true;
    }
    return LOOPBACK.includes(String(req.socket.remoteAddress));
}

module.exports = from_this_machine;
