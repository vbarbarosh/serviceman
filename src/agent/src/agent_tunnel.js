const agent_file_get = require('./agent_file_get');
const agent_file_part_put = require('./agent_file_part_put');
const agent_file_put = require('./agent_file_put');
const agent_fs_tree = require('./agent_fs_tree');
const agent_fs_watch = require('./agent_fs_watch');
const agent_machine_shell = require('./agent_machine_shell');
const agent_path_expand = require('./agent_path_expand');
const agent_tar_get = require('./agent_tar_get');
const agent_tar_put = require('./agent_tar_put');
const link_send_stream = require('../../helpers/link_send_stream');
const net = require('net');
const tunnel_window = require('../../helpers/tunnel_window');

const LAST_ID = 0xffffffff;

// The far end of a tunnelled stream: a real socket to something on this machine
function agent_tunnel(state, kind, body)
{
    const id = body.readUInt32BE(0);
    const rest = body.subarray(4);
    if (kind === 'o') {
        stream_open(state, id, JSON.parse(rest.toString('utf8')));
        return;
    }
    const found = state.streams[id];
    if (found === undefined) {
        // A stream this end already dropped; the frames still on the way mean nothing
        return;
    }
    if (kind === 'd') {
        stream_write(state, found, rest);
        return;
    }
    if (kind === 'e') {
        found.socket.end();
        return;
    }
    if (kind === 'r') {
        stream_credit(found, rest.readUInt32BE(0));
        return;
    }
    stream_drop(state, found, null);
}

// The far end is usually a socket; a target that says `shell` is a pty on this machine, and
// one that says `file` or `part` is a file, or a part of one, being written here, and `tar_put`
// many files in one tar. Each of them answers the way a socket does, which is the whole of what
// a tunnelled stream asks of its end.
function stream_open(state, id, target)
{
    let socket;
    try {
        socket = target_socket(target);
    }
    catch (error) {
        // A target this agent cannot open — a kind from a newer host above all — is one dead
        // stream, never a dead link
        link_send_stream(state.link, 'x', id, Buffer.from(JSON.stringify({code: 'EBADTARGET', message: error.message})));
        return;
    }
    stream_attach(state, id, socket, tunnel_window(target));
}

// A socket at this end of a stream, whichever end opened it: its bytes go out as frames, what
// it is sent is written to it, and it says one word when it is over. It sends no more than its
// window unread (tunnel_window), and no more while the link has not taken what it sent.
function stream_attach(state, id, socket, window_bytes)
{
    const found = {id, socket, credit: window_bytes, ended: false, gone: false};
    state.streams[id] = found;
    socket.setNoDelay(true);
    socket.on('data', function (chunk) {
        found.credit -= chunk.length;
        const room = link_send_stream(state.link, 'd', id, chunk);
        if ((found.credit <= 0) || (room === false)) {
            socket.pause();
        }
        if (room === false) {
            state.link.once('drain', function () {
                stream_resume(found);
            });
        }
    });
    socket.on('end', function () {
        found.ended = true;
        link_send_stream(state.link, 'e', id);
    });
    socket.on('error', function (error) {
        stream_drop(state, found, error);
    });
    socket.on('close', function () {
        stream_drop(state, found, null);
    });
}

function target_socket(target)
{
    if (target.shell !== undefined) {
        return agent_machine_shell(target.shell);
    }
    if (target.file !== undefined) {
        return agent_file_put(target.file);
    }
    if (target.part !== undefined) {
        return agent_file_part_put(target.part);
    }
    if (target.tar_put !== undefined) {
        return agent_tar_put(target.tar_put);
    }
    if (target.read !== undefined) {
        return agent_file_get(target.read);
    }
    if (target.tar !== undefined) {
        return agent_tar_get(target.tar);
    }
    if (target.watch !== undefined) {
        return agent_fs_watch(target.watch);
    }
    if (target.tree !== undefined) {
        return agent_fs_tree(target.tree);
    }
    if (target.path !== undefined) {
        return net.connect({path: agent_path_expand(target.path)});
    }
    return net.connect({host: (target.host === undefined) ? '127.0.0.1' : target.host, port: target.port});
}

function stream_write(state, found, chunk)
{
    if (found.socket.destroyed) {
        return;
    }
    found.socket.write(chunk, function () {
        if (found.gone === false) {
            link_send_stream(state.link, 'r', found.id, bytes_body(chunk.length));
        }
    });
}

function stream_credit(found, bytes)
{
    found.credit += bytes;
    stream_resume(found);
}

function stream_resume(found)
{
    if ((found.gone === false) && (found.credit > 0)) {
        found.socket.resume();
    }
}

// Says once that the stream is over, then forgets it
function stream_drop(state, found, error)
{
    if (found.gone) {
        return;
    }
    found.gone = true;
    delete state.streams[found.id];
    link_send_stream(state.link, 'x', found.id, Buffer.from(JSON.stringify(gone_from_error(error))));
    found.socket.destroy();
}

function gone_from_error(error)
{
    if (error === null) {
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

// A stream this end opens, which is one thing and no more: something knocked at the http
// socket of this machine, and serviceman is being asked to answer it. The numbers are split so
// both ends may open streams on one link — this machine takes the odd ones.
agent_tunnel.open = function (state, socket, target) {
    const id = free_id(state);
    link_send_stream(state.link, 'o', id, Buffer.from(JSON.stringify(target)));
    stream_attach(state, id, socket, tunnel_window.WINDOW_BYTES);
    return id;
};

function free_id(state)
{
    for (;;) {
        state.next_stream_id = (state.next_stream_id + 2 >= LAST_ID) ? 1 : state.next_stream_id + 2;
        if (state.streams[state.next_stream_id] === undefined) {
            return state.next_stream_id;
        }
    }
}

module.exports = agent_tunnel;
