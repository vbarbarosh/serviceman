const fs = require('fs');
const path = require('path');
const shared_path = require('./shared_path');

const FILE_MODE = 0o600;

// The whole of it, written whole and readable by nobody else: opened with the mode it must
// have, so there is no moment where its secrets are anybody's to read
function shared_write(app, shared)
{
    const file = shared_path(app);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temp = `${file}.new`;
    fs.writeFileSync(temp, `${JSON.stringify(shared, null, 4)}\n`, {mode: FILE_MODE});
    fs.chmodSync(temp, FILE_MODE);
    fs.renameSync(temp, file);
}

module.exports = shared_write;
