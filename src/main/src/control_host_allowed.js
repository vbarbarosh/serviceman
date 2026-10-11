const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '::1'];

// A page on another site can point a name it owns at 127.0.0.1 and read what answers there as
// if it were its own (DNS rebinding). The control page answers its own names only, so a
// stranger's name never reaches it.
function control_host_allowed(app, req)
{
    const host = host_from_header(String(req.headers.host || '').toLowerCase());
    if (LOOPBACK_NAMES.includes(host)) {
        return true;
    }
    if ((app.config.control.host !== null) && (host === app.config.control.host)) {
        return true;
    }
    return app.config.control.names.includes(host);
}

function host_from_header(text)
{
    if (text.startsWith('[')) {
        return text.slice(1, text.indexOf(']'));
    }
    return text.split(':')[0];
}

module.exports = control_host_allowed;
