const crypto = require('crypto');

// What is kept of a token: its sha256, enough to know it again and no use to whoever reads it
function control_token_hash(token)
{
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = control_token_hash;
