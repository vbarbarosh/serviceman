const fs = require('fs');
const logline_tokens_path = require('./logline_tokens_path');

// {<remote>: {endpoint, ips, token, revoke}} — what Logline issued to each remote, as serviceman
// last heard it. Read once; after that the process holds it, and writes it back when it changes.
function logline_tokens_read(app)
{
    if (app.logline_tokens !== undefined) {
        return app.logline_tokens;
    }
    let text = null;
    try {
        text = fs.readFileSync(logline_tokens_path(app), 'utf8');
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
    const kept = (text === null) ? {} : JSON.parse(text);
    app.logline_tokens = ((kept === null) || (typeof kept !== 'object') || Array.isArray(kept)) ? {} : kept;
    return app.logline_tokens;
}

module.exports = logline_tokens_read;
