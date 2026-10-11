const crypto = require('crypto');

const TOKEN_BYTES = 32;

// Tokens after one is issued for a name: the one already there when the addresses are the same,
// so asking twice changes nothing; a new one in its place when they are not.
function token_issue(tokens, name, ips, now)
{
    const wanted = ips.slice().sort();
    const found = tokens.find(v => v.name === name);
    if ((found !== undefined) && (JSON.stringify(found.ips.slice().sort()) === JSON.stringify(wanted))) {
        return {tokens, item: found};
    }
    const item = {name, token: crypto.randomBytes(TOKEN_BYTES).toString('hex'), ips: wanted, issued_at: new Date(now).toISOString()};
    return {tokens: tokens.filter(v => v.name !== name).concat([item]), item};
}

module.exports = token_issue;
