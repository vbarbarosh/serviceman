const config_remote_add = require('./config_remote_add');
const crypto = require('crypto');
const log_event = require('./log_event');

const RE_TAG = /^[a-z0-9][a-z0-9_-]*$/;
const NAME_LETTERS = 12;
// A tailnet name is one its owner chose for the machine, so it is kept whole: a DNS label is at
// most this long
const TAILNET_LETTERS = 63;
const TOKEN_BYTES = 32;

// A machine that holds the join token adds itself. It says which machine it is and what it
// claims to be; this end keeps the claims the config allows and drops the rest, writes the new
// remote into the file, and hands back the remote it has become.
//
// The machine it says it is, is what makes it the same machine next time — a container that
// comes back under the same name takes its old entry instead of leaving a dead one behind.
// `tailnet` is its name on the tailnet (laptop.tail1234.ts.net), '' for none: the new remote is
// named after it, so the machine has one name in serviceman and in Tailscale.
async function remote_join(app, machine, claimed, from, tailnet)
{
    const known = app.remotes.find(v => v.machine === machine);
    if (known !== undefined) {
        return known;
    }
    const tags = claimed.filter(v => app.config.join.tags_allowed.includes(v));
    const refused = claimed.filter(v => tags.includes(v) === false);
    const remote = {
        name: name_free(app, machine, (tailnet === undefined) ? '' : tailnet),
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
        refused: (refused.length === 0) ? null : refused,
    });
    return app.remote_by_name[remote.name];
}

// A name made of what the machine is called on the tailnet, or of what it calls itself, so the
// config reads like the fleet looks
function name_free(app, machine, tailnet)
{
    const first = tailnet.split('.')[0];
    const slug = (first === '') ? slug_of(machine, NAME_LETTERS) : slug_of(first, TAILNET_LETTERS);
    const stem = `${app.config.join.name_prefix}${RE_TAG.test(slug) ? slug : 'machine'}`;
    if (app.remote_by_name[stem] === undefined) {
        return stem;
    }
    return `${stem}-${crypto.randomBytes(3).toString('hex')}`;
}

function slug_of(text, letters)
{
    return text.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, letters);
}

module.exports = remote_join;
