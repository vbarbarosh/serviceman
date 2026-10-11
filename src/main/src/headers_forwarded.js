const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

// The request headers as the service should see them: hop-by-hop dropped, the caller announced
function headers_forwarded(req, keep_upgrade)
{
    const out = {};
    for (const name of Object.keys(req.headers)) {
        if (HOP_BY_HOP.includes(name) && (keep_upgrade !== true)) {
            continue;
        }
        out[name] = req.headers[name];
    }
    const before = req.headers['x-forwarded-for'];
    // What this hop adds is the address it was reached from. A connection through a machine's
    // link was reached from nowhere: the chain already in the header is the whole of it.
    const address = ((req.socket.tunnel_from === undefined) ? req.socket.remoteAddress || '' : '');
    out['x-forwarded-for'] = [before, address].filter(v => (v !== undefined) && (v !== '')).join(', ');
    out['x-forwarded-proto'] = proto_of(req);
    out['x-forwarded-host'] = req.headers.host || '';
    return out;
}

// What the visitor spoke. This host answers http, so a request that reached it directly is
// http whatever it claims; one that came through a machine's link was taken by something in
// front of that machine, and only that thing knows whether the visitor spoke https.
function proto_of(req)
{
    if ((req.socket.tunnel_from !== undefined) && (req.headers['x-forwarded-proto'] !== undefined)) {
        return String(req.headers['x-forwarded-proto']);
    }
    return (req.socket.encrypted ? 'https' : 'http');
}

module.exports = headers_forwarded;
