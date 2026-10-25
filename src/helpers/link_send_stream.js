const link_send = require('./link_send');

const EMPTY = Buffer.alloc(0);
// The most a data frame carries. The reader at the far end refuses a frame over 16 MiB and
// drops the whole link with it, so what a sender hands over at once, a whole tar in one
// Buffer say, goes in pieces of this.
const CHUNK_BYTES = 1024*1024;

// A frame that belongs to one stream inside the link: its number leads the body. A data body
// longer than a frame carries goes as several, in order; the stream is bytes either way.
function link_send_stream(socket, kind, id, body)
{
    const bytes = (body === undefined) ? EMPTY : body;
    if ((kind !== 'd') || (bytes.length <= CHUNK_BYTES)) {
        return frame_send(socket, kind, id, bytes);
    }
    let flushed = true;
    for (let at = 0; at < bytes.length; at += CHUNK_BYTES) {
        flushed = frame_send(socket, kind, id, bytes.subarray(at, at + CHUNK_BYTES));
    }
    return flushed;
}

function frame_send(socket, kind, id, body)
{
    const head = Buffer.allocUnsafe(4);
    head.writeUInt32BE(id, 0);
    return link_send(socket, kind, [head, body]);
}

link_send_stream.CHUNK_BYTES = CHUNK_BYTES;

module.exports = link_send_stream;
