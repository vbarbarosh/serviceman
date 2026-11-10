const link_send_stream = require('../../../helpers/link_send_stream');
const stream = require('stream');
const tunnel_window = require('../../../helpers/tunnel_window');

// A wide stream keeps on its way about this much of the pace the far end takes its bytes, so a
// call sent after them waits about this long on any link: a full 4 MB held one 40 s on a link
// of 100 KB/s. A second of the pace is more than a round trip of any link, so a fast link fills.
const AHEAD_MS = 1000;
// The pace is what the far end took over the last PACE_SPAN_MS; less than PACE_LEAST_MS says nothing
const PACE_SPAN_MS = 2000;
const PACE_LEAST_MS = 200;
// How often the pace is noted: a credit comes for every piece the far end wrote, hundreds a second
const PACE_NOTE_MS = 50;
// How often a wide stream notes how much it had sent, and for how long the notes are kept: what
// it had sent half a minute ago, and has not been taken since, is a way that does not carry
// (link_stood)
const MARK_EVERY_MS = 250;
const MARKS_KEPT_MS = 600000;
// How far past its window the far end's last piece may reach. A sender begins a piece while it
// has room and sends it whole (agent_tunnel), so it is over by less than one piece: what a
// socket, a pipe or a file hands over at once, 64 KB, which goes as one frame. A frame's length
// is taken; a piece longer than a frame is its opener's to say (tunnel_open).
const PIECE_BYTES = link_send_stream.CHUNK_BYTES;
const EMPTY = Buffer.alloc(0);

// One stream inside a link. It looks like a socket to node's http, and its bytes ride in
// frames beside the bytes of every other stream on the same link. Neither end sends more than
// a window of unread bytes, so a slow reader on one side never fills the memory of the other.
// This end holds the far one to it, whose word is not taken for it: a stream sent more than the
// room it gave, a piece over at most (`piece_bytes`), or given room for bytes it never sent, is
// dropped with EWINDOW (window_broken), and the link carries on. Room for bytes the link has
// not taken yet is room once it has taken them (taken_count): they wait in this host's memory.
//
// The number is the stream's name on that link: every frame of it leads with the number, and
// both ends know it by nothing else.
//
// `half_open` keeps the way out open after the way in has ended, as a forward needs it to be:
// a client that says it is done and waits for the answer gets the answer. `window_bytes` is how
// much it may send unread (tunnel_window): a stream wider than the default, a file's bytes,
// also waits for the link to take what it sent, so it never queues up ahead of the others, and
// keeps about a second of the pace its bytes are taken at, its own window at most: from the
// start, a second of `pace_bps`, the speed the link was last measured at, or the default window
// on a link never measured.
function tunnel_stream(socket, id, half_open, window_bytes, pace_bps, piece_bytes)
{
    const most = (window_bytes === undefined) ? tunnel_window.WINDOW_BYTES : window_bytes;
    const wide = (most > tunnel_window.WINDOW_BYTES);
    const piece = (piece_bytes === undefined) ? PIECE_BYTES : piece_bytes;
    const link = {
        send_data: function (chunk) {
            const room = link_send_stream(socket, 'd', id, chunk);
            // An empty write behind the frame: the link calls back when it has taken all that
            // was written before it, and the far end can have read these bytes no sooner
            socket.write(EMPTY, function (error) {
                if (((error === null) || (error === undefined)) && (out.destroyed === false)) {
                    link_took += chunk.length;
                    taken_count();
                }
            });
            return room;
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
    // How much may be on its way unread now: a wide stream's follows the pace (pace_note)
    let limit = wide ? window_of(pace_bps) : most;
    // [at, taken] over the last PACE_SPAN_MS, and [at, sent] over the last MARKS_KEPT_MS, of a
    // wide stream
    const paces = [];
    const marks = [];
    let unread = 0;
    // What the far end says it read of what was sent, and what the link took of it, in all
    let said_taken = 0;
    let link_took = 0;
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
            out.sent += chunk.length;
            if (wide) {
                mark_note(Date.now());
            }
            if (wide && (room === false)) {
                backed_up = true;
                socket.once('drain', function () {
                    backed_up = false;
                    if (out.destroyed === false) {
                        release();
                    }
                });
            }
            if ((room_left() > 0) && (backed_up === false)) {
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

    // How far its bytes got, both ways, and when they last moved: what a machine whose answers
    // wait behind them shows (link_carrying)
    out.wide = wide;
    out.opened_at = Date.now();
    out.sent = 0;
    out.taken = 0;
    out.taken_at = null;
    out.got = 0;
    out.got_at = null;

    // What the other end sends. `unread` is what came since room was last given: an end that
    // keeps its window began its last piece with a byte of room at least, so a window and a
    // piece unread is one byte more than it ever sends. Answers what the log says of a stream
    // dropped for it (window_broken), as tunnel_credit does, or null.
    out.tunnel_data = function (chunk) {
        timer_arm();
        unread += chunk.length;
        out.got += chunk.length;
        out.got_at = Date.now();
        if (unread >= most + piece) {
            return window_broken(`its far end sent ${unread} bytes unread into a window of ${most}`, {reason: 'stream_past_window', stream: id, unread, window: most});
        }
        out.push(chunk);
        return null;
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
    // The far end read these bytes: room for more, and word that they got there, for whoever
    // watches a copy move ('taken'). It reads only what it was sent: room for more than is on
    // its way is room for bytes that would wait in this host's memory, not at the far end.
    out.tunnel_credit = function (bytes) {
        const on_its_way = out.sent - said_taken;
        if (bytes > on_its_way) {
            return window_broken(`its far end made room for ${bytes} bytes, and ${on_its_way} were on their way`, {reason: 'stream_room_unsent', stream: id, room: bytes, on_its_way});
        }
        said_taken += bytes;
        taken_count();
        return null;
    };
    // What the far end read counts as far as the link has taken it: bytes still in this host's
    // queue were read by nobody, whatever was said of them, and they are room once they went
    function taken_count() {
        const bytes = Math.min(said_taken, link_took) - out.taken;
        if (bytes === 0) {
            return;
        }
        out.taken += bytes;
        out.taken_at = Date.now();
        if (wide) {
            pace_note(out.taken_at);
        }
        out.emit('taken', bytes);
        release();
    }
    // How much it had sent by `at`, as far as its notes say (never more than it had): what it
    // sent half a minute ago and is still not taken is what a call asked since waits behind
    out.sent_by = function (at) {
        for (let i = marks.length - 1; i >= 0; --i) {
            if (marks[i][0] <= at) {
                return marks[i][1];
            }
        }
        return 0;
    };
    // The far end kept no window: the stream is over at both ends with the reason (send_gone),
    // once, and `words` are handed back for the log, which remote_attach says once a link
    function window_broken(message, words) {
        if (out.destroyed) {
            return null;
        }
        const error = new Error(`stream ${id}: ${message}`);
        error.code = 'EWINDOW';
        out.destroy(error);
        return words;
    }
    // The write held back goes on once there is room at the far end, and in the link
    function release() {
        if ((held === null) || (room_left() <= 0) || backed_up) {
            return;
        }
        const done = held;
        held = null;
        done();
    }
    function room_left() {
        const on_its_way = out.sent - out.taken;
        return limit - on_its_way;
    }
    // The far end took more: the pace over the last PACE_SPAN_MS sets how much may be on its way
    function pace_note(now) {
        const last = paces[paces.length - 1];
        if ((last === undefined) || (now - last[0] >= PACE_NOTE_MS)) {
            paces.push([now, out.taken]);
        }
        while ((paces.length > 2) && (now - paces[1][0] >= PACE_SPAN_MS)) {
            paces.shift();
        }
        const [first_at, first_taken] = paces[0];
        if (now - first_at < PACE_LEAST_MS) {
            return;
        }
        limit = window_of((out.taken - first_taken)*1000/(now - first_at));
    }
    // About AHEAD_MS of a pace, between the default window and its own; the default for no pace
    function window_of(pace) {
        if ((pace === undefined) || (pace === null)) {
            return tunnel_window.WINDOW_BYTES;
        }
        return Math.min(most, Math.max(tunnel_window.WINDOW_BYTES, Math.round(pace*AHEAD_MS/1000)));
    }
    // How much it had sent by now: a note every MARK_EVERY_MS, the newest kept up to date
    function mark_note(now) {
        const last = marks.length - 1;
        if ((last >= 1) && (marks[last][0] - marks[last - 1][0] < MARK_EVERY_MS)) {
            marks[last] = [now, out.sent];
            return;
        }
        marks.push([now, out.sent]);
        while ((marks.length > 2) && (now - marks[1][0] >= MARKS_KEPT_MS)) {
            marks.shift();
        }
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
