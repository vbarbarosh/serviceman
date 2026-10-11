const crypto = require('crypto');

// How many machines this host remembers taking away. It is a handful of names on any real
// fleet, and the oldest is forgotten rather than kept forever.
const KEEP = 100;

// A machine that was taken out of the config: its token is remembered, hashed, so an agent
// that dials in with it afterwards can be told what happened instead of being turned away as
// a stranger. It is remembered until this process ends — a machine that dials in after a
// restart is simply a stranger again, and its own bin/uninstall is the way out then.
function remote_removed_add(app, remote)
{
    app.removed.push({
        name: remote.name,
        mark: crypto.createHash('sha256').update(String(remote.token)).digest('hex'),
        at: Date.now(),
    });
    while (app.removed.length > KEEP) {
        app.removed.shift();
    }
}

module.exports = remote_removed_add;
