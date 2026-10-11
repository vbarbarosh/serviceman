// The machine whose files a host header names — <name>.fs.<control host> — or null for
// every other host. A name with a dot of its own cannot ride one label and stays unnamed.
function fs_host_of(app, req)
{
    const control_host = app.config.control.host;
    if (control_host === null) {
        return null;
    }
    const host = host_of(String(req.headers.host || '').toLowerCase());
    const mark = `.fs.${control_host}`;
    if (host.endsWith(mark) === false) {
        return null;
    }
    const name = host.slice(0, -mark.length);
    return (/^[^.]+$/.test(name) ? name : null);
}

function host_of(text)
{
    if (text.startsWith('[')) {
        return text.slice(1, text.indexOf(']'));
    }
    return text.split(':')[0];
}

module.exports = fs_host_of;
