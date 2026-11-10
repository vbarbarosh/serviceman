// The frames of a tunnelled stream, on their way back from the remote. Answers what the log
// says of a stream dropped for what the remote did with its window (tunnel_stream), or null.
function tunnel_read(remote, kind, body)
{
    const found = remote.state.streams[body.readUInt32BE(0)];
    if (found === undefined) {
        // A stream this end already closed; the frames still on the way mean nothing
        return null;
    }
    const rest = body.subarray(4);
    if (kind === 'd') {
        return found.tunnel_data(rest);
    }
    if (kind === 'e') {
        found.tunnel_end();
        return null;
    }
    if (kind === 'r') {
        return found.tunnel_credit(rest.readUInt32BE(0));
    }
    found.tunnel_gone(error_from_body(rest));
    return null;
}

function error_from_body(body)
{
    const said = (body.length === 0) ? {} : JSON.parse(body.toString('utf8'));
    if (said.code === undefined) {
        return null;
    }
    const out = new Error(said.message);
    out.code = said.code;
    return out;
}

module.exports = tunnel_read;
