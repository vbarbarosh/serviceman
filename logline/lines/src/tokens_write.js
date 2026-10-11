const fs = require('fs');
const path = require('path');

// The whole list, written the way nothing half-written can be read: a file of its own, synced,
// then renamed over the old one, and the folder synced so the rename itself survives a crash.
// Mode 600: every token in it lets a machine write to the log.
function tokens_write(file, tokens)
{
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temp = `${file}.new`;
    const fd = fs.openSync(temp, 'w', 0o600);
    try {
        fs.writeFileSync(fd, `${JSON.stringify({tokens}, null, 4)}\n`);
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

module.exports = tokens_write;
