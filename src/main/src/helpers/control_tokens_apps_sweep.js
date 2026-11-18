const control_tokens_read = require('./control_tokens_read');
const control_tokens_write = require('./control_tokens_write');

// The apps the tokens made, kept to the apps there are, once a config is applied: a name gone
// from it leaves every token's list, so an app made under it later is not taken for theirs; and
// a name that is a new service now, made by the owner or by a token, is nobody's until its
// maker puts it on its own list (control_token_app_made). The second holds the first where it
// could not run: an app removed by hand from the config file while serviceman was stopped. A
// rename is neither: its new name carries the old one's place on the lists before this runs
// (service_rename_ties).
//
//     made  the names that are new services in this config, the new names of renames aside
function control_tokens_apps_sweep(app, made)
{
    const names = new Set(app.services.map(v => v.name));
    function kept(name) {
        return names.has(name) && (made.includes(name) === false);
    }
    const tokens = control_tokens_read(app);
    if (tokens.every(v => (Array.isArray(v.apps) === false) || v.apps.every(kept))) {
        return;
    }
    control_tokens_write(app, tokens.map(v => Array.isArray(v.apps) ? Object.assign({}, v, {apps: v.apps.filter(kept)}) : v));
}

module.exports = control_tokens_apps_sweep;
