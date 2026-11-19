const databases_path = require('./databases_path');
const fs = require('fs');
const path = require('path');

const FILE_MODE = 0o600;

// The whole of it, written whole and readable by nobody else: opened with the mode it must
// have, so there is no moment where its passwords are anybody's to read
function databases_write(app, databases)
{
    const file = databases_path(app);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temp = `${file}.new`;
    fs.writeFileSync(temp, `${JSON.stringify(databases, null, 4)}\n`, {mode: FILE_MODE});
    fs.chmodSync(temp, FILE_MODE);
    fs.renameSync(temp, file);
}

module.exports = databases_write;
