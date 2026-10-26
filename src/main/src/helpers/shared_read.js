const fs = require('fs');
const shared_path = require('./shared_path');

// The shared folders as kept: {home, folders, mounts, told}
//
//   home     null, or {remote, address, redis_port, s3_port, secrets, phase, error, at}
//   folders  [{name, created}]
//   mounts   [{folder, remote, path, mode}], mode rw or ro
//   told     the machines given a table with mounts, so one whose last mount went is told so
function shared_read(app)
{
    let text;
    try {
        text = fs.readFileSync(shared_path(app), 'utf8');
    }
    catch {
        return {home: null, folders: [], mounts: [], told: []};
    }
    const kept = JSON.parse(text);
    return {
        home: ((kept.home === undefined) || (kept.home === null)) ? null : kept.home,
        folders: Array.isArray(kept.folders) ? kept.folders : [],
        mounts: Array.isArray(kept.mounts) ? kept.mounts : [],
        told: Array.isArray(kept.told) ? kept.told : [],
    };
}

module.exports = shared_read;
