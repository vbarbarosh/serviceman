// Who asked, as an address. A connection that came in through a machine's link has none of its
// own: whatever stands in front of that machine is the only thing that saw the visitor, and
// what it wrote down is the whole of what there is. Nothing else can have written it — that
// door is a file, and its mode says who may open it.
function client_address(req)
{
    if (req.socket.tunnel_from === undefined) {
        return ((req.socket.remoteAddress === undefined) ? '' : req.socket.remoteAddress);
    }
    const real = req.headers['x-real-ip'];
    if (real !== undefined) {
        return String(real).trim();
    }
    return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
}

module.exports = client_address;
