const fs = require('fs');
const path = require('path');
const secrets_path = require('./secrets_path');

const FILE_MODE = 0o600;

// The whole store, written whole and readable by nobody else. It is opened with the mode it
// must have rather than fixed afterwards, so there is no moment where it is anybody's to read.
function secrets_write(app, secrets)
{
    const file = secrets_path(app);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temp = `${file}.new`;
    fs.writeFileSync(temp, `${JSON.stringify(secrets, null, 4)}\n`, {mode: FILE_MODE});
    fs.chmodSync(temp, FILE_MODE);
    fs.renameSync(temp, file);
}

module.exports = secrets_write;
