const logline_revoke = require('./logline_revoke');
const logline_tell = require('./logline_tell');
const logline_tokens_read = require('./logline_tokens_read');

// Every connected machine told what it should know, and every token that could not be taken
// back tried again. Run after every config change and once a minute; a machine already told
// the same thing is not asked again.
async function logline_sweep(app)
{
    const kept = logline_tokens_read(app);
    const all = [];
    for (const name of Object.keys(kept)) {
        if ((kept[name].revoke === true) && (app.remote_by_name[name] === undefined)) {
            all.push(logline_revoke(app, name));
        }
    }
    for (const remote of app.remotes) {
        all.push(logline_tell(app, remote));
    }
    await Promise.all(all);
}

module.exports = logline_sweep;
