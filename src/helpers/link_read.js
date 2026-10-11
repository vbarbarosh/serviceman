const HEADER_BYTES = 5;
const LONGEST_FRAME_BYTES = 16*1024*1024;

// Reads whole frames off a link socket; TCP hands them over cut and glued in any way
function link_read(socket, on_frame)
{
    let rest = Buffer.alloc(0);
    socket.on('data', function (chunk) {
        rest = ((rest.length === 0) ? chunk : Buffer.concat([rest, chunk]));
        for (;;) {
            if (rest.length < HEADER_BYTES) {
                return;
            }
            const length = rest.readUInt32BE(0);
            if (length > LONGEST_FRAME_BYTES) {
                socket.destroy(new Error(`a frame of ${length} bytes is larger than this link carries`));
                return;
            }
            if (rest.length < HEADER_BYTES + length) {
                return;
            }
            const kind = String.fromCharCode(rest.readUInt8(4));
            const body = Buffer.from(rest.subarray(HEADER_BYTES, HEADER_BYTES + length));
            rest = rest.subarray(HEADER_BYTES + length);
            on_frame(kind, body);
        }
    });
}

module.exports = link_read;
