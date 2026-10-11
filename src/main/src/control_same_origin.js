// Whether a browser sent this from the control page itself. A caller that is not a browser
// names no site and no origin, and passes.
function control_same_origin(req)
{
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined) {
        return ((site === 'same-origin') || (site === 'none'));
    }
    if (req.headers.origin === undefined) {
        return true;
    }
    const origin = url_parse(req.headers.origin);
    if (origin === null) {
        return false;
    }
    const host = url_parse(`${origin.protocol}//${req.headers.host || ''}`);
    return ((host !== null) && (host.host === origin.host));
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

module.exports = control_same_origin;
