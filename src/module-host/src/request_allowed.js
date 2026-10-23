const crypto = require('crypto');
const page_key = require('./page_key');

const COOKIE = 'module_host_key';

// Asked only by this app's own page, in the browser of the user who started it. The address is
// the loopback one it listens on, so a name that some site points at 127.0.0.1 is refused; the
// API is the page's that holds the key (page_key), not another user's of this computer; and a
// change comes from a page of this origin, so another site open in the same browser cannot post
// to it. A shell, the files and ufw are behind it.
//
//     asked = {method, url, headers}
function request_allowed(asked)
{
    const host = String(asked.headers.host || '');
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) === false) {
        return false;
    }
    const pathname = new URL(asked.url, 'http://module-host.invalid').pathname;
    if (pathname.startsWith('/api/') && (key_held(asked) === false)) {
        return false;
    }
    if ((asked.method === 'GET') || (asked.method === 'HEAD')) {
        return true;
    }
    return (asked.headers.origin === `http://${host}`);
}

// Whether the request carries the key: the cookie GET /?key= put in this browser
function key_held(asked)
{
    const found = String(asked.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`));
    if (found === undefined) {
        return false;
    }
    const held = Buffer.from(found.slice(COOKIE.length + 1));
    const key = Buffer.from(page_key());
    return (held.length === key.length) && crypto.timingSafeEqual(held, key);
}

request_allowed.COOKIE = COOKIE;

module.exports = request_allowed;
