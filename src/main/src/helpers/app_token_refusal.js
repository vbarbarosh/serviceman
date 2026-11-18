const control_tokens_read = require('./control_tokens_read');

// How many of a token's apps a refusal names before it counts the rest
const NAMED_MAX = 10;

// Why a token may not send an app under this name, in words that end "the token … ", or null
// when it may. A token kept to the apps it makes (apps_own) sends a name serviceman has not
// seen, which becomes one of its own, and the names it made already (apps); any other name is
// an app someone else has, the owner's or another token's, and stays theirs. A token without
// the keep sends under any name, as the owner does. The token is read as it is now: the owner
// may have changed it while its zip was on its way.
//
//     token  the token the request came with; undefined for the owner
function app_token_refusal(app, token, name)
{
    if (token === undefined) {
        return null;
    }
    const now = control_tokens_read(app).find(v => (v.id === token.id));
    if (now === undefined) {
        return 'is revoked';
    }
    if ((now.apps_own !== true) || (app.service_by_name[name] === undefined)) {
        return null;
    }
    const made = Array.isArray(now.apps) ? now.apps : [];
    if (made.includes(name)) {
        return null;
    }
    return `may not send a new version of ${name}: it sends only the apps it made, ${made_said(made)}`;
}

// notes, wiki; a long list cut, its rest counted
function made_said(made)
{
    if (made.length === 0) {
        return 'and it has made none';
    }
    if (made.length > NAMED_MAX) {
        return `${made.slice(0, NAMED_MAX).join(', ')} and ${made.length - NAMED_MAX} more`;
    }
    return made.join(', ');
}

module.exports = app_token_refusal;
