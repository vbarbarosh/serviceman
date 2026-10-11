const time_utc_nanos = require('./time_utc_nanos');

const STREAMS = {1: 'stdout', 2: 'stderr'};

// Docker's log stream, as the engine sends it with timestamps=1 -> lines {stream, at, text}, in
// the one order docker wrote them.
//
// A container without a terminal gets both of its streams in one: frames of an 8-byte header —
// which stream, and how long — then the bytes. One with a terminal (docker run -t) has one
// stream and no frames. Every line starts with docker's stamp and a space. A line docker cut —
// it cuts at 16K — comes as pieces, each stamped, and only the last ends in a newline: the
// pieces are one line, at the first piece's time.
function docker_log_reader(tty)
{
    let pending = Buffer.alloc(0);
    const open = {stdout: null, stderr: null};
    return {
        push: function (chunk) {
            pending = Buffer.concat([pending, chunk]);
            const out = [];
            if (tty) {
                const cut = pending.lastIndexOf(10);
                if (cut === -1) {
                    return out;
                }
                piece_read(open, 'stdout', pending.subarray(0, cut + 1).toString('utf8'), out);
                pending = pending.subarray(cut + 1);
                return out;
            }
            while (pending.length >= 8) {
                const size = pending.readUInt32BE(4);
                if (pending.length < 8 + size) {
                    break;
                }
                piece_read(open, STREAMS[pending[0]] || 'stdout', pending.subarray(8, 8 + size).toString('utf8'), out);
                pending = pending.subarray(8 + size);
            }
            return out;
        },
        // What is left when the stream ends: a last line that never got its newline
        end: function () {
            const out = [];
            if (tty && (pending.length > 0)) {
                piece_read(open, 'stdout', `${pending.toString('utf8')}\n`, out);
            }
            for (const stream of ['stdout', 'stderr']) {
                if (open[stream] !== null) {
                    out.push(open[stream]);
                    open[stream] = null;
                }
            }
            return out;
        },
    };
}

// One frame's worth: stamped pieces, each a whole line when it ends in a newline
function piece_read(open, stream, text, out)
{
    const parts = text.split('\n');
    const last = parts.pop();
    for (const part of parts) {
        piece_add(open, stream, part, true, out);
    }
    if (last !== '') {
        piece_add(open, stream, last, false, out);
    }
}

function piece_add(open, stream, part, whole, out)
{
    const space = part.indexOf(' ');
    const at = ((space === -1) ? null : time_utc_nanos(part.slice(0, space)));
    const text = ((at === null) ? part : part.slice(space + 1));
    if (open[stream] === null) {
        open[stream] = {stream, at, text};
    }
    else {
        open[stream].text += text;
    }
    if (whole) {
        out.push(open[stream]);
        open[stream] = null;
    }
}

module.exports = docker_log_reader;
