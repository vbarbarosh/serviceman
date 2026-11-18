const control_tokens_read = require('./control_tokens_read');
const control_tokens_write = require('./control_tokens_write');

// An app a token made, put on its list (apps) and written down, so it is that token's to send
// new versions of across restarts. Every token that makes an app keeps it there, kept to the
// apps it makes or not: the keep ticked later finds the apps it made. The name stays the token's
// until the app is renamed, which carries it (service_rename_ties), or removed, which takes it
// off (control_tokens_apps_sweep).
//
//     token  the token the request came with; undefined for the owner, who keeps no list
function control_token_app_made(app, token, name)
{
    if (token === undefined) {
        return;
    }
    const tokens = control_tokens_read(app);
    const found = tokens.find(v => (v.id === token.id));
    if ((found === undefined) || (Array.isArray(found.apps) && found.apps.includes(name))) {
        return;
    }
    const apps = (Array.isArray(found.apps) ? found.apps : []).concat([name]);
    control_tokens_write(app, tokens.map(v => (v === found) ? Object.assign({}, v, {apps}) : v));
}

module.exports = control_token_app_made;
