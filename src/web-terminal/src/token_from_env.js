const crypto = require('crypto');

// The token the page asks for: WEB_TERMINAL_TOKEN, or one made now and said once, since a
// terminal with no token in front of it is a shell for whoever reaches the address
function token_from_env(env, say)
{
    const given = String((env.WEB_TERMINAL_TOKEN === undefined) ? '' : env.WEB_TERMINAL_TOKEN).trim();
    if (given !== '') {
        return given;
    }
    const made = `wt_${crypto.randomBytes(32).toString('base64url')}`;
    say(`web-terminal: WEB_TERMINAL_TOKEN is not set, so the page asks for this one: ${made}`);
    return made;
}

module.exports = token_from_env;
