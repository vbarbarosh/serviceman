const control_tokens_path = require('./control_tokens_path');
const fs = require('fs');
const path = require('path');

const FILE_MODE = 0o600;

// The tokens, written whole and readable by nobody else, and kept on the app as they are now
function control_tokens_write(app, tokens)
{
    const file = control_tokens_path(app);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temp = `${file}.new`;
    fs.writeFileSync(temp, `${JSON.stringify(tokens, null, 4)}\n`, {mode: FILE_MODE});
    fs.chmodSync(temp, FILE_MODE);
    fs.renameSync(temp, file);
    app.control_tokens = tokens;
}

module.exports = control_tokens_write;
