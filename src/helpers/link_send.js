const HEADER_BYTES = 5;

// One frame on a remote link: four bytes of length, one byte of kind, then the body.
// The kind is a letter — 'm' for a JSON message, 'b' for a blast of filler, and the
// letters of a tunnelled stream: 'o' open, 'd' data, 'e' end, 'x' gone, 'r' room for more.
// The body may be given in pieces, so a stream frame carries its bytes without a copy.
function link_send(socket, kind, body)
{
    const parts = Array.isArray(body) ? body : [body];
    let length = 0;
    for (const part of parts) {
        length += part.length;
    }
    const head = Buffer.allocUnsafe(HEADER_BYTES);
    head.writeUInt32BE(length, 0);
    head.writeUInt8(kind.charCodeAt(0), 4);
    let flushed = socket.write(head);
    for (const part of parts) {
        flushed = socket.write(part);
    }
    return flushed;
}

module.exports = link_send;
