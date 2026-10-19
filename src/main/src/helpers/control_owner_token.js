const control_token_new = require('./control_token_new');
const fs = require('fs');
const path = require('path');

const FILE_MODE = 0o600;

// The owner's token, which may do everything: made the first time serviceman needs it, and
// kept as it is in owner.token in the state dir, readable by nobody else, where bin/owner-token
// reads it for whoever runs serviceman. A serviceman that runs as root, as in a rootful docker,
// gives the file to whoever owns the state dir, the person who owns ./data on the host. Two
// servicemans of one state dir starting at once keep the one written first.
// SERVICEMAN_OWNER_TOKEN, when set, is the owner's token instead, and no file is written.
function control_owner_token(app)
{
    if (app.owner_token !== undefined) {
        return app.owner_token;
    }
    const given = String((process.env.SERVICEMAN_OWNER_TOKEN === undefined) ? '' : process.env.SERVICEMAN_OWNER_TOKEN).trim();
    if (given !== '') {
        app.owner_token = given;
        return given;
    }
    const file = path.resolve(app.state_dir, 'owner.token');
    let token = token_read(file);
    if (token === null) {
        fs.mkdirSync(path.dirname(file), {recursive: true});
        const temp = `${file}.${process.pid}.new`;
        fs.writeFileSync(temp, `${control_token_new()}\n`, {mode: FILE_MODE});
        if ((typeof process.getuid === 'function') && (process.getuid() === 0)) {
            const owner = fs.statSync(path.dirname(file));
            fs.chownSync(temp, owner.uid, owner.gid);
        }
        try {
            fs.linkSync(temp, file);
        }
        catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
        fs.rmSync(temp, {force: true});
        token = token_read(file);
    }
    app.owner_token = token;
    return token;
}

function token_read(file)
{
    let text;
    try {
        text = fs.readFileSync(file, 'utf8').trim();
    }
    catch {
        return null;
    }
    return (text === '') ? null : text;
}

module.exports = control_owner_token;
