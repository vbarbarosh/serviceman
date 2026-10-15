const forward_join = require('./forward_join');
const link_send_stream = require('../../../helpers/link_send_stream');
const tunnel_stream = require('./tunnel_stream');

// A stream the machine opened, which is the other direction from every other one. A forward is
// joined to its other end (forward_join); anything else is a request
// reached that machine's http socket — nginx in front of it — and it is handed here to be
// answered. The stream is given to the services door as if something had connected to it, so
// the hostname decides what answers, a sleeping service is woken, and the log reads the same
// as it does for a visitor who reached this host directly.
function tunnel_inbound(app, remote, body)
{
    const state = remote.state;
    const id = body.readUInt32BE(0);
    const target = JSON.parse(body.subarray(4).toString('utf8'));
    // This host takes the even numbers and a machine the odd: one that comes in on the wrong
    // side of that line is a machine that would be writing over a stream this end opened
    if ((id % 2 === 0) || (state.streams[id] !== undefined)) {
        refuse(state, id, 'EBADSTREAM', `stream ${id} is not one for that end to open`);
        return;
    }
    // Something connected to a forward on that machine, and is carried on to the other end
    if (typeof target.forward === 'string') {
        forward_join(app, remote, id, target.forward);
        return;
    }
    if (target.http === undefined) {
        refuse(state, id, 'EBADTARGET', 'a machine opens an http stream or a forward on this host, and nothing else');
        return;
    }
    if (app.servers === null) {
        refuse(state, id, 'ENOTREADY', 'this host is not answering yet');
        return;
    }
    const stream = tunnel_stream(state.socket, id);
    state.streams[id] = stream;
    stream.id = id;
    stream.on('close', function () {
        delete state.streams[id];
    });
    // Which machine carried it here. It is also what says this connection is not this host's
    // own — a stream has no address, and without it a request through a link would be read as
    // one from the machine serviceman runs on.
    stream.tunnel_from = remote.name;
    app.servers.server.emit('connection', stream);
}

// One stream that never began, and a link that carries on
function refuse(state, id, code, message)
{
    link_send_stream(state.socket, 'x', id, Buffer.from(JSON.stringify({code, message})));
}

module.exports = tunnel_inbound;
