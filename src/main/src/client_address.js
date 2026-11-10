const net = require('net');

// Who asked, as an address. A connection that came in through a machine's link has none of its
// own: whatever stands in front of that machine is the only thing that saw the visitor, and
// what it vouches for is the whole of what there is. A front adds the address it saw to the end
// of x-forwarded-for, after whatever the visitor wrote there: the last one is the front's word,
// and the ones before it are the visitor's to write. A front that writes x-real-ip alone says
// it there. What is not an address is no answer at all. At this host's own door the socket
// says it, and no header is read.
function client_address(req)
{
    if (req.socket.tunnel_from === undefined) {
        return (req.socket.remoteAddress === undefined) ? '' : req.socket.remoteAddress;
    }
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (net.isIP(forwarded) !== 0) {
        return forwarded;
    }
    const real = String(req.headers['x-real-ip'] || '').trim();
    return (net.isIP(real) === 0) ? '' : real;
}

module.exports = client_address;
