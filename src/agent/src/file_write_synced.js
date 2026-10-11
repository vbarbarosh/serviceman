const fs = require('fs');
const path = require('path');

// A whole file, the way no crash leaves half of one: written beside, synced, renamed over the
// old one, and the folder synced so the rename itself is on disk when this returns
function file_write_synced(file, text, mode)
{
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
    const temp = `${file}.new`;
    const fd = fs.openSync(temp, 'w', ((mode === undefined) ? 0o600 : mode));
    try {
        fs.writeFileSync(fd, text);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
    const dir = fs.openSync(path.dirname(file), 'r');
    try {
        fs.fsyncSync(dir);
    }
    finally {
        fs.closeSync(dir);
    }
}

module.exports = file_write_synced;
