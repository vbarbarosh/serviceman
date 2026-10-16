const crypto = require('crypto');

// A token for the control door: 32 random bytes, said in letters and digits a shell does not
// read anything into
function control_token_new()
{
    return `sm_${crypto.randomBytes(32).toString('base64url')}`;
}

module.exports = control_token_new;
