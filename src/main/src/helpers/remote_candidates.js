const remote_tags = require('./remote_tags');

const TAG_MARK = '#';

// The machines a service may run on, in the order it prefers them. A name is one machine; a
// `#tag` is every machine carrying that tag, in the order they stand in the config. A machine
// named twice — by name and by a tag — is kept once, where it was first asked for.
function remote_candidates(app, service)
{
    const out = [];
    for (const item of service.remotes) {
        for (const remote of remotes_of(app, item)) {
            if (out.includes(remote) === false) {
                out.push(remote);
            }
        }
    }
    return out;
}

function remotes_of(app, item)
{
    if (item.startsWith(TAG_MARK)) {
        const tag = item.slice(TAG_MARK.length);
        return app.remotes.filter(v => remote_tags(v).includes(tag));
    }
    const found = app.remote_by_name[item];
    return ((found === undefined) ? [] : [found]);
}

module.exports = remote_candidates;
