const fs = require('fs');
const logline_tokens_path = require('./logline_tokens_path');
const path = require('path');

// The tokens, written so a crash never leaves half a file: synced, renamed over the old one,
// mode 600. Each of them lets a machine write to the log.
function logline_tokens_write(app)
{
    const file = logline_tokens_path(app);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temp = `${file}.new`;
    const fd = fs.openSync(temp, 'w', 0o600);
    try {
        fs.writeFileSync(fd, `${JSON.stringify(app.logline_tokens, null, 4)}\n`);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
}

module.exports = logline_tokens_write;
