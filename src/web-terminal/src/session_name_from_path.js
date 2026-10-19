// The session a path names: `/play` is the kept session `play`, `/` is an unnamed terminal (''),
// and anything else names nothing (null). A name is what tmux takes as it is; `_` starts the
// page's own files, so no session begins with it.
function session_name_from_path(pathname)
{
    if (pathname === '/') {
        return '';
    }
    const match = /^\/([a-z0-9][a-z0-9_-]{0,63})\/?$/.exec(pathname);
    return (match === null) ? null : match[1];
}

module.exports = session_name_from_path;
