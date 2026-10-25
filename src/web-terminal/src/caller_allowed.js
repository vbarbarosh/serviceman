const crypto = require('crypto');

const COOKIE = 'web_terminal_token';

// Whether a request brings the token: as Authorization: Bearer <token>, or in the cookie the
// page is given when it signs in. Compared by digest, in constant time.
function caller_allowed(req, token)
{
    const given = token_given(req);
    if (given === null) {
        return false;
    }
    return crypto.timingSafeEqual(digest(given), digest(token));
}

function token_given(req)
{
    const auth = req.headers.authorization;
    if ((typeof auth === 'string') && auth.startsWith('Bearer ')) {
        return auth.slice('Bearer '.length).trim();
    }
    const cookie = req.headers.cookie;
    if (typeof cookie !== 'string') {
        return null;
    }
    for (const part of cookie.split(';')) {
        const at = part.indexOf('=');
        if ((at !== -1) && (part.slice(0, at).trim() === COOKIE)) {
            return decoded(part.slice(at + 1).trim());
        }
    }
    return null;
}

// A cookie that is not valid percent-encoding is no token at all
function decoded(text)
{
    try {
        return decodeURIComponent(text);
    }
    catch {
        return null;
    }
}

function digest(text)
{
    return crypto.createHash('sha256').update(String(text)).digest();
}

caller_allowed.COOKIE = COOKIE;

module.exports = caller_allowed;
