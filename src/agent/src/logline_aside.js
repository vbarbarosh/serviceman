const fs = require('fs');
const path = require('path');

// No more than this is kept aside. Past it a line Logline refuses waits in the spool, and every
// line behind it with it, until whoever owns the machine has made room: lines are held, never
// dropped, as the spool holds them at its cap.
const ASIDE_FILES = 1000;
const ASIDE_BYTES = 64*1024*1024;

// What Logline said it will never take, kept in refused/ of the spool's folder for whoever
// owns the machine: how many files, how many bytes, and whether no more fit.
//
// {files, bytes, full}
function logline_aside(dir)
{
    const out = {files: 0, bytes: 0, full: false};
    let names = [];
    try {
        names = fs.readdirSync(path.join(dir, 'refused'));
    }
    catch {
        // No refused/ yet: nothing was put aside
    }
    for (const name of names.filter(v => v.endsWith('.json'))) {
        try {
            out.bytes += fs.statSync(path.join(dir, 'refused', name)).size;
            out.files += 1;
        }
        catch {
            // Taken away between the two looks
        }
    }
    out.full = (out.files >= ASIDE_FILES) || (out.bytes >= ASIDE_BYTES);
    return out;
}

module.exports = logline_aside;
