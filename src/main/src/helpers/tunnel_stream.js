const link_send_stream = require('../../../helpers/link_send_stream');
const stream = require('stream');
const tunnel_window = require('../../../helpers/tunnel_window');

// One stream inside a link. It looks like a socket to node's http, and its bytes ride in
// frames beside the bytes of every other stream on the same link. Neither end sends more than
// a window of unread bytes, so a slow reader on one side never fills the memory of the other.
//
// The number is the stream's name on that link: every frame of it leads with the number, and
// both ends know it by nothing else.
//
// `half_open` keeps the way out open after the way in has ended, as a forward needs it to be:
// a client that says it is done and waits for the answer gets the answer. `window_bytes` is how
// much it may send unread (tunnel_window): a stream wider than the default, a file's bytes,
// also waits for the link to take what it sent, so it never queues up ahead of the others.
function tunnel_stream(socket, id, half_open, window_bytes)
{
    const wide = (window_bytes !== undefined) && (window_bytes > tunnel_window.WINDOW_BYTES);
    const link = {
        send_data: function (chunk) {
            return link_send_stream(socket, 'd', id, chunk);
        },
        send_end: function () {
            link_send_stream(socket, 'e', id);
        },
        send_gone: function (error) {
            link_send_stream(socket, 'x', id, Buffer.from(JSON.stringify(gone_from_error(error))));
        },
        send_credit: function (bytes) {
            link_send_stream(socket, 'r', id, bytes_body(bytes));
        },
    };
    let credit = (window_bytes === undefined) ? tunnel_window.WINDOW_BYTES : window_bytes;
    let unread = 0;
    let held = null;
    // A wide stream whose last bytes the link has not taken yet
    let backed_up = false;
    let gone = false;
    let ended = false;
    let timeout_ms = 0;
    let timer = null;

    const out = new stream.Duplex({
        allowHalfOpen: (half_open === true),
        write: function (chunk, encoding, done) {
            timer_arm();
            const room = link.send_data(chunk);
            credit -= chunk.length;
            if (wide && (room === false)) {
                backed_up = true;
                socket.once('drain', function () {
                    backed_up = false;
                    if (out.destroyed === false) {
                        release();
                    }
                });
            }
            if ((credit > 0) && (backed_up === false)) {
                done();
                return;
            }
            held = done;
        },
        final: function (done) {
            link.send_end();
            done();
        },
        read: function () {
            if (unread === 0) {
                return;
            }
            link.send_credit(unread);
            unread = 0;
        },
        destroy: function (error, done) {
            timer_clear();
            if (gone === false) {
                link.send_gone(error);
            }
            done(error);
        },
    });

    // What the other end sends
    out.tunnel_data = function (chunk) {
        timer_arm();
        unread += chunk.length;
        out.push(chunk);
    };
    out.tunnel_end = function () {
        end_in();
    };
    out.tunnel_gone = function (error) {
        gone = true;
        if (error === null) {
            end_in();
            return;
        }
        out.destroy(error);
    };
    out.tunnel_credit = function (bytes) {
        credit += bytes;
        release();
    };
    // The write held back goes on once there is room at the far end, and in the link
    function release() {
        if ((held === null) || (credit <= 0) || backed_up) {
            return;
        }
        const done = held;
        held = null;
        done();
    }

    // Node drives a socket, and a socket answers all of these
    out.setNoDelay = function () {
        return out;
    };
    out.setKeepAlive = function () {
        return out;
    };
    // A socket takes the listener off again when it is asked for no timeout at all, and node's
    // http client leans on that: it arms the timeout for a request and disarms it with
    // setTimeout(0, fn) when the answer is in. Adding one either way leaves a listener behind
    // on every request that shares a kept-alive socket, and eleven of them is a warning.
    out.setTimeout = function (ms, listener) {
        timeout_ms = ms;
        if (listener !== undefined) {
            if (ms === 0) {
                out.removeListener('timeout', listener);
            }
            else {
                out.once('timeout', listener);
            }
        }
        timer_arm();
        return out;
    };
    out.ref = function () {
        return out;
    };
    out.unref = function () {
        return out;
    };
    out.destroySoon = function () {
        out.end();
    };

    function end_in() {
        if (ended) {
            return;
        }
        ended = true;
        out.push(null);
    }

    function timer_arm() {
        timer_clear();
        if (timeout_ms > 0) {
            timer = setTimeout(function () {
                out.emit('timeout');
            }, timeout_ms);
        }
    }

    function timer_clear() {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    }

    return out;
}

function gone_from_error(error)
{
    if ((error === null) || (error === undefined)) {
        return {};
    }
    return {code: (error.code === undefined) ? 'ECONNRESET' : error.code, message: error.message};
}

function bytes_body(bytes)
{
    const out = Buffer.allocUnsafe(4);
    out.writeUInt32BE(bytes, 0);
    return out;
}

module.exports = tunnel_stream;
