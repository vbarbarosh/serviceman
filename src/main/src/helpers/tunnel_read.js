// The frames of a tunnelled stream, on their way back from the remote
function tunnel_read(remote, kind, body)
{
    const found = remote.state.streams[body.readUInt32BE(0)];
    if (found === undefined) {
        // A stream this end already closed; the frames still on the way mean nothing
        return;
    }
    const rest = body.subarray(4);
    if (kind === 'd') {
        found.tunnel_data(rest);
        return;
    }
    if (kind === 'e') {
        found.tunnel_end();
        return;
    }
    if (kind === 'r') {
        found.tunnel_credit(rest.readUInt32BE(0));
        return;
    }
    found.tunnel_gone(error_from_body(rest));
}

function error_from_body(body)
{
    const said = ((body.length === 0) ? {} : JSON.parse(body.toString('utf8')));
    if (said.code === undefined) {
        return null;
    }
    const out = new Error(said.message);
    out.code = said.code;
    return out;
}

module.exports = tunnel_read;
