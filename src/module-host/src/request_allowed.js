// Asked only by this app's own page: the address is the loopback one it listens on, so a name
// that some site points at 127.0.0.1 is refused, and a change comes from a page of this origin,
// so another site open in the same browser cannot post to it. ufw runs as root behind it.
function request_allowed(req)
{
    const host = String(req.headers.host || '');
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) === false) {
        return false;
    }
    if ((req.method === 'GET') || (req.method === 'HEAD')) {
        return true;
    }
    return (req.headers.origin === `http://${host}`);
}

module.exports = request_allowed;
