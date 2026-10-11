const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// The token other machines' agents ask this machine's agent with, made the first time it is
// wanted and kept beside the secrets, never in the config: {<remote>: token}. Read once; the
// process holds it after that, and writes it back when one is made.
function door_token(app, name)
{
    const kept = tokens_of(app);
    if (kept[name] === undefined) {
        kept[name] = crypto.randomBytes(32).toString('hex');
        tokens_write(app);
    }
    return kept[name];
}

function tokens_of(app)
{
    if (app.door_tokens !== undefined) {
        return app.door_tokens;
    }
    let text = null;
    try {
        text = fs.readFileSync(tokens_path(app), 'utf8');
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
    const kept = ((text === null) ? {} : JSON.parse(text));
    app.door_tokens = (((kept === null) || (typeof kept !== 'object') || Array.isArray(kept)) ? {} : kept);
    return app.door_tokens;
}

// Written so a crash never leaves half a file: synced, renamed over the old one, mode 600. Each
// of them lets a caller into every service of a machine.
function tokens_write(app)
{
    const file = tokens_path(app);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temp = `${file}.new`;
    const fd = fs.openSync(temp, 'w', 0o600);
    try {
        fs.writeFileSync(fd, `${JSON.stringify(app.door_tokens, null, 4)}\n`);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
}

function tokens_path(app)
{
    return path.resolve(app.state_dir, 'door_tokens.json');
}

module.exports = door_token;
