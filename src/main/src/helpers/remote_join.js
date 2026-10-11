const config_remote_add = require('./config_remote_add');
const crypto = require('crypto');
const log_event = require('./log_event');

const RE_TAG = /^[a-z0-9][a-z0-9_-]*$/;
const NAME_LETTERS = 12;
const TOKEN_BYTES = 32;

// A machine that holds the join token adds itself. It says which machine it is and what it
// claims to be; this end keeps the claims the config allows and drops the rest, writes the new
// remote into the file, and hands back the remote it has become.
//
// The machine it says it is, is what makes it the same machine next time — a container that
// comes back under the same name takes its old entry instead of leaving a dead one behind.
async function remote_join(app, machine, claimed, from)
{
    const out = app.remotes.find(v => v.machine === machine);
    if (out !== undefined) {
        return out;
    }
    const tags = claimed.filter(v => app.config.join.tags_allowed.includes(v));
    const refused = claimed.filter(v => tags.includes(v) === false);
    const remote = {
        name: name_free(app, machine),
        token: crypto.randomBytes(TOKEN_BYTES).toString('hex'),
        machine,
        tags,
    };
    await config_remote_add(app, remote);
    log_event(app, 'remote_joined', {
        remote: remote.name,
        machine,
        from,
        tags,
        refused: ((refused.length === 0) ? null : refused),
    });
    return app.remote_by_name[remote.name];
}

// A name made of what the machine calls itself, so the config reads like the fleet looks
function name_free(app, machine)
{
    const slug = machine.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, NAME_LETTERS);
    const stem = `${app.config.join.name_prefix}${RE_TAG.test(slug) ? slug : 'machine'}`;
    if (app.remote_by_name[stem] === undefined) {
        return stem;
    }
    return `${stem}-${crypto.randomBytes(3).toString('hex')}`;
}

module.exports = remote_join;
