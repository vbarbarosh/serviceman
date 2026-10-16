const control_owner_token = require('./control_owner_token');
const control_token_hash = require('./control_token_hash');
const control_tokens_read = require('./control_tokens_read');
const crypto = require('crypto');

const COOKIE = 'serviceman_token';

// Who is asking the control door, by the token it brings: as Authorization: Bearer <token>,
// or in the cookie the page is given when its owner signs in. {owner: true} for the owner's,
// {owner: false, token} for one made for a reader, null for no token or one nobody holds.
function control_caller(app, req)
{
    const given = token_given(req);
    if (given === null) {
        return null;
    }
    const hash = control_token_hash(given);
    if (crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(control_token_hash(control_owner_token(app)), 'hex'))) {
        return {owner: true, token: null};
    }
    const token = control_tokens_read(app).find(v => v.sha256 === hash);
    if (token === undefined) {
        return null;
    }
    return {owner: false, token};
}

function token_given(req)
{
    const auth = req.headers.authorization;
    if ((typeof auth === 'string') && /^Bearer\s+\S+$/i.test(auth)) {
        return auth.replace(/^Bearer\s+/i, '');
    }
    const cookies = String((req.headers.cookie === undefined) ? '' : req.headers.cookie).split(';');
    for (const cookie of cookies) {
        const at = cookie.indexOf('=');
        if ((at !== -1) && (cookie.slice(0, at).trim() === COOKIE)) {
            const value = cookie.slice(at + 1).trim();
            return ((value === '') ? null : decodeURIComponent(value));
        }
    }
    return null;
}

control_caller.COOKIE = COOKIE;

module.exports = control_caller;
