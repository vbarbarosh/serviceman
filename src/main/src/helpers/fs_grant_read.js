const crypto = require('crypto');

// The grant a text holds (fs_grant_make), or null: for a text that is none, one this
// serviceman did not sign, and one whose time is over.
function fs_grant_read(app, text)
{
    const parts = String(text).split('.');
    if (parts.length !== 2) {
        return null;
    }
    const signed = crypto.createHmac('sha256', app.fs_grant_key).update(parts[0]).digest();
    const given = Buffer.from(parts[1], 'base64url');
    if ((given.length !== signed.length) || (crypto.timingSafeEqual(given, signed) === false)) {
        return null;
    }
    const grant = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return (grant.until > Date.now()) ? grant : null;
}

module.exports = fs_grant_read;
