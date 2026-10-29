const link_send_stream = require('../../../helpers/link_send_stream');
const path = require('path');
const tunnel_stream = require('./tunnel_stream');
const tunnel_window = require('../../../helpers/tunnel_window');

const LAST_ID = 0xffffffff;

// Opens a stream to something on the remote's machine: a port on its loopback, or a socket
// file on its disk. Nothing is opened on that machine — the link it dialled out carries this.
function tunnel_open(remote, target)
{
    const state = remote.state;
    if (state.phase !== 'online') {
        throw new Error(`remote ${remote.name} is ${state.phase} — its agent is not dialled in`);
    }
    const socket = state.socket;
    const id = free_id(state);
    const out = tunnel_stream(socket, id, false, tunnel_window(target));
    state.streams[id] = out;
    // The far end knows the stream by this number — a resize call has to name it
    out.id = id;
    out.carries = carried_of(target);
    out.on('close', function () {
        delete state.streams[id];
    });
    link_send_stream(socket, 'o', id, Buffer.from(JSON.stringify(target)));
    return out;
}

// The numbers are split, so both ends of a link may open a stream without ever choosing the
// same one: this host takes the even, a machine takes the odd. The step never crosses that
// line, wrap included.
function free_id(state)
{
    for (;;) {
        state.next_stream_id = (state.next_stream_id + 2 >= LAST_ID) ? 2 : state.next_stream_id + 2;
        if (state.streams[state.next_stream_id] === undefined) {
            return state.next_stream_id;
        }
    }
}

// The file a stream carries, and which way: {way: 'to' or 'from' the machine, name}, or null
// for a stream that is not a file's bytes (a shell, a port, a watch)
function carried_of(target)
{
    if ((target === null) || (typeof target !== 'object')) {
        return null;
    }
    if (target.file !== undefined) {
        return {way: 'to', name: String(target.file.name)};
    }
    if (target.part !== undefined) {
        return {way: 'to', name: String(target.part.name)};
    }
    if (target.tar_put !== undefined) {
        return {way: 'to', name: `a tar into ${path.posix.basename(String(target.tar_put.dir)) || '/'}`};
    }
    if (target.read !== undefined) {
        return {way: 'from', name: path.posix.basename(String(target.read.path))};
    }
    if (target.tar !== undefined) {
        return {way: 'from', name: `a tar of ${path.posix.basename(String(target.tar.dir)) || '/'}`};
    }
    return null;
}

module.exports = tunnel_open;
