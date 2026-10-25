const fs = require('fs');
const path = require('path');
const remotes_claimed_read = require('./remotes_claimed_read');

// A machine that added itself has dialled in with its own token: written down, so the join
// token is refused for its name from now on, across restarts of this host too
function remote_claimed_mark(app, name)
{
    const claimed = remotes_claimed_read(app);
    if (claimed.has(name)) {
        return false;
    }
    claimed.add(name);
    const file = path.join(app.state_dir, remotes_claimed_read.FILE);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temp = `${file}.new`;
    fs.writeFileSync(temp, `${JSON.stringify(Array.from(claimed).sort(), null, 4)}\n`);
    fs.renameSync(temp, file);
    return true;
}

module.exports = remote_claimed_mark;
