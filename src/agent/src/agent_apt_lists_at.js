const fs = require('fs');
const path = require('path');

// apt's own mark of a fetch that went well (Ubuntu's 15update-stamp and the daily fetch touch
// it), and the folder its package lists are moved into as they come
const STAMP = '/var/lib/apt/periodic/update-success-stamp';
const LISTS = '/var/lib/apt/lists';

// When apt last fetched its package lists, in ms, the newer of the two; null on a machine that
// shows neither. What apt counts as waiting is as old as this: an update published since is
// not in it until the lists are fetched again.
function agent_apt_lists_at(base)
{
    const times = [STAMP, LISTS].map(function (file) {
        try {
            return fs.statSync(path.join(base, file)).mtimeMs;
        }
        catch {
            return null;
        }
    }).filter(v => v !== null);
    return (times.length === 0) ? null : Math.round(Math.max(...times));
}

agent_apt_lists_at.STAMP = STAMP;

module.exports = agent_apt_lists_at;
