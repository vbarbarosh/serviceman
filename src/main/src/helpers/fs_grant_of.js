const fs_grant_covers = require('./fs_grant_covers');
const fs_grant_read = require('./fs_grant_read');

const COOKIE = 'serviceman_fs';

// The grant a request to a machine's file address brings for this path, among the cookies it
// was given when its files were opened from the File Manager; null when none opens the path.
// A browser keeps one cookie for each folder opened, and sends those whose folder holds the path.
function fs_grant_of(app, req, remote_name, asked)
{
    const cookies = String((req.headers.cookie === undefined) ? '' : req.headers.cookie).split(';');
    for (const cookie of cookies) {
        const at = cookie.indexOf('=');
        if ((at === -1) || (cookie.slice(0, at).trim() !== COOKIE)) {
            continue;
        }
        const grant = fs_grant_read(app, cookie.slice(at + 1).trim());
        if ((grant !== null) && fs_grant_covers(grant, remote_name, asked)) {
            return grant;
        }
    }
    return null;
}

fs_grant_of.COOKIE = COOKIE;

module.exports = fs_grant_of;
