// Whether a browser sent this handshake from the terminal's own page. A browser names the
// page in Origin, and the page is the terminal's own when that is the host and the port the
// handshake was sent to (Host): serviceman and a machine's door pass both on as the browser
// wrote them. Host is read under the Origin's scheme, since https ends before this server and
// the scheme's usual port is written in neither. A caller that is not a browser names no
// origin, and passes.
function is_same_origin(req)
{
    if (req.headers.origin === undefined) {
        return true;
    }
    const origin = url_parse(req.headers.origin);
    if (origin === null) {
        return false;
    }
    const host = url_parse(`${origin.protocol}//${req.headers.host || ''}`);
    return (host !== null) && (host.host === origin.host);
}

function url_parse(text)
{
    try {
        return new URL(text);
    }
    catch {
        return null;
    }
}

module.exports = is_same_origin;
