const fs = require('fs');
const path = require('path');

const FILE = 'remotes_claimed.json';

// The machines that added themselves and have since dialled in with the token of their own
// the host handed them: for each, the join token joins nothing any more. A name here is a
// remote's; the file is a list, kept in the state dir and read once onto the app.
function remotes_claimed_read(app)
{
    if (app.remotes_claimed !== undefined) {
        return app.remotes_claimed;
    }
    let kept = [];
    try {
        kept = JSON.parse(fs.readFileSync(path.join(app.state_dir, FILE), 'utf8'));
    }
    catch {
        kept = [];
    }
    app.remotes_claimed = new Set(Array.isArray(kept) ? kept.filter(v => typeof v === 'string') : []);
    return app.remotes_claimed;
}

remotes_claimed_read.FILE = FILE;

module.exports = remotes_claimed_read;
