const forward_join = require('./forward_join');
const link_send_stream = require('../../../helpers/link_send_stream');
const tunnel_stream = require('./tunnel_stream');

// The most streams a machine has open towards this host at once. It opens one for each request
// its door hands on to this host and one for each connection to a forward on it, for as long as
// each lasts: a browser loading one page over HTTP/2 asks for up to 128 things at once, and
// this host opens 128 at most to one service of a machine (tunnel_agent). Eight times that: one
// that says nothing costs this host about 13 KB, and one whose reader stands, a window and a
// piece unread at most (tunnel_stream).
const STREAMS_MOST = 1024;

// A stream the machine opened, which is the other direction from every other one. A forward is
// joined to its other end (forward_join); anything else is a request
// reached that machine's http socket — nginx in front of it — and it is handed here to be
// answered. The stream is given to the services door as if something had connected to it, so
// the hostname decides what answers, a sleeping service is woken, and the log reads the same
// as it does for a visitor who reached this host directly.
//
// A machine opens none before its hello, as no agent does (agent_serve), and STREAMS_MOST at
// once: one more is refused as one dead stream, which a visitor at its door meets as a 502 and
// a connection to a forward as a close. Answers what the log says of that refusal, or null.
function tunnel_inbound(app, remote, body)
{
    const state = remote.state;
    const id = body.readUInt32BE(0);
    const target = JSON.parse(body.subarray(4).toString('utf8'));
    if (state.phase !== 'online') {
        refuse(state, id, 'ENOHELLO', 'a machine says hello before it opens a stream');
        return {reason: 'stream_before_hello', stream: id};
    }
    // This host takes the even numbers and a machine the odd: one that comes in on the wrong
    // side of that line is a machine that would be writing over a stream this end opened
    if ((id % 2 === 0) || (state.streams[id] !== undefined)) {
        refuse(state, id, 'EBADSTREAM', `stream ${id} is not one for that end to open`);
        return null;
    }
    if (state.streams_in >= tunnel_inbound.most) {
        refuse(state, id, 'ETOOMANY', `${remote.name} has ${state.streams_in} streams open towards this host, and that is the most`);
        return {reason: 'streams_most', stream: id, open: state.streams_in, most: tunnel_inbound.most};
    }
    // Something connected to a forward on that machine, and is carried on to the other end
    if (typeof target.forward === 'string') {
        forward_join(app, remote, id, target.forward);
        counted(state, id);
        return null;
    }
    if (target.http === undefined) {
        refuse(state, id, 'EBADTARGET', 'a machine opens an http stream or a forward on this host, and nothing else');
        return null;
    }
    if (app.servers === null) {
        refuse(state, id, 'ENOTREADY', 'this host is not answering yet');
        return null;
    }
    const stream = tunnel_stream(state.socket, id);
    state.streams[id] = stream;
    stream.id = id;
    stream.on('close', function () {
        delete state.streams[id];
    });
    counted(state, id);
    // Which machine carried it here. It is also what says this connection is not this host's
    // own — a stream has no address, and without it a request through a link would be read as
    // one from the machine serviceman runs on.
    stream.tunnel_from = remote.name;
    app.servers.server.emit('connection', stream);
    return null;
}

// A stream the machine opened, counted for as long as it is open; one that was refused is not
// there to count. A link that drops starts a new table and a new count (link_gone), and a
// stream of the old link, which closes after it, takes nothing off the new one.
function counted(state, id)
{
    const table = state.streams;
    if (table[id] === undefined) {
        return;
    }
    state.streams_in++;
    table[id].on('close', function () {
        if (state.streams === table) {
            state.streams_in--;
        }
    });
}

// One stream that never began, and a link that carries on
function refuse(state, id, code, message)
{
    link_send_stream(state.socket, 'x', id, Buffer.from(JSON.stringify({code, message})));
}

// Fewer in a test, which fills a machine's door
tunnel_inbound.most = STREAMS_MOST;

module.exports = tunnel_inbound;
