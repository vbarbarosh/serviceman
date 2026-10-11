// One request in flight on this connection, until its answer is finished. `connection_end`
// says how many were still unfinished when the socket closed: a visitor who walked away, or
// work nobody is waiting for any more.
function socket_pending(socket, res)
{
    socket.log_pending++;
    res.once('close', function () {
        socket.log_pending--;
    });
}

module.exports = socket_pending;
