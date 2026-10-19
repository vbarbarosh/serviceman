const link_send = require('./link_send');

const EMPTY = Buffer.alloc(0);

// A frame that belongs to one stream inside the link: its number leads the body
function link_send_stream(socket, kind, id, body)
{
    const head = Buffer.allocUnsafe(4);
    head.writeUInt32BE(id, 0);
    return link_send(socket, kind, [head, (body === undefined) ? EMPTY : body]);
}

module.exports = link_send_stream;
