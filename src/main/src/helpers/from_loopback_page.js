const is_localhost_url = require('./is_localhost_url');

// Was this request sent by a page loaded from this machine's loopback? A browser sets Origin
// itself, and resolves localhost and every name under it to loopback only, so a key the page
// sends never crossed a network on its way in, though docker's bridge shows it from 172.17.0.1.
// A program can write any Origin, but then it is its own key it sends in the clear.
function from_loopback_page(req)
{
    const origin = req.headers.origin;
    if ((req.socket.tunnel_from !== undefined) || (typeof origin !== 'string')) {
        return false;
    }
    try {
        return is_localhost_url(origin) || ['127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
    }
    catch {
        return false;
    }
}

module.exports = from_loopback_page;
