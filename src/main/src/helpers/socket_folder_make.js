const fs = require('fs');
const log_event = require('./log_event');
const path = require('path');

// The folder an app's socket goes in, when it is inside serviceman's own state folder and not
// there yet: made, so the program told to listen on data/sockets/va.sock can. Each folder made is
// the state folder's owner's, as the config file in it is: serviceman runs as root in its
// container, and a folder root made there would be one the program out on the host could not
// write its socket into. A path outside the state folder is its owner's to make.
function socket_folder_make(app, file)
{
    const state = path.resolve(app.state_dir);
    const inside = path.relative(state, path.dirname(file));
    if ((inside === '') || inside.startsWith('..') || path.isAbsolute(inside)) {
        return;
    }
    let dir = state;
    try {
        const owner = fs.statSync(state);
        for (const part of inside.split(path.sep)) {
            dir = path.join(dir, part);
            if (fs.existsSync(dir)) {
                continue;
            }
            fs.mkdirSync(dir, {mode: 0o700});
            fs.chownSync(dir, owner.uid, owner.gid);
        }
    }
    catch (error) {
        log_event(app, 'socket_folder_error', {folder: dir, reason: error.message});
    }
}

module.exports = socket_folder_make;
