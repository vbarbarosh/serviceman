const fs = require('fs');
const path = require('path');

// One mark for the whole folder: the newest thing in it. It goes on every address the control
// page imports, so a changed file is a changed address — and an address a browser has never
// seen is an address it cannot serve from yesterday's cache.
function asset_stamp(root)
{
    let newest = 0;
    for (const name of fs.readdirSync(root)) {
        const found = stat_or_null(path.join(root, name));
        if ((found !== null) && found.isFile() && (found.mtimeMs > newest)) {
            newest = found.mtimeMs;
        }
    }
    return Math.round(newest).toString(36);
}

function stat_or_null(target)
{
    try {
        return fs.statSync(target);
    }
    catch {
        return null;
    }
}

module.exports = asset_stamp;
