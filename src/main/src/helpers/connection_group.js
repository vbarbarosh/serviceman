const format_seconds = require('../../../helpers/format_seconds');
const log_bind = require('./log_bind');
const log_event = require('./log_event');
const log_group_root = require('./log_group_root');

// Every visitor line has something above it: the connection it came in on. One socket carries
// many requests, and each of them says which socket it belongs to, so a line can be walked up
// to the client that opened it and across to everything else that client asked for.
function connection_group(app, socket)
{
    const time0 = Date.now();
    log_group_root(app, function (group) {
        socket.log_group = group;
        socket.log_pending = 0;
        log_event(app, 'connection_begin', client_text(socket));
        socket.on('close', log_bind(function () {
            // Whatever lives on this connection — a websocket, a shell — says its last word
            // while the socket is closing, and this line is written after all of them, so a
            // group is never closed in the file before the work under it
            setImmediate(function () {
                log_event(app, 'connection_end', `${format_seconds(Date.now() - time0)} pending=${socket.log_pending}`);
            });
        }));
    });
}

// A socket file has no address on the other end: whoever opened it is on this machine
function client_text(socket)
{
    // One that came in through a machine's link: the visitor's own address is in the headers
    // whatever stands in front of that machine wrote, not on the stream
    if (socket.tunnel_from !== undefined) {
        return `through ${socket.tunnel_from}`;
    }
    if (socket.remoteAddress === undefined) {
        return 'this machine';
    }
    return `${socket.remoteAddress}:${socket.remotePort}`;
}

module.exports = connection_group;
