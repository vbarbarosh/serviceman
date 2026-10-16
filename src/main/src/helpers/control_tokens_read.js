const control_tokens_path = require('./control_tokens_path');
const fs = require('fs');

// Every token made for a caller of the control door, the owner's aside:
//
//     {id, label, sha256, remotes, reads, made_at}
//
// remotes  the machines it sees, by name
// reads    what it may read of them: status, logs, metrics, processes
//
// Read once and kept on the app; a file that is missing or not a list is no tokens at all.
function control_tokens_read(app)
{
    if (app.control_tokens !== undefined) {
        return app.control_tokens;
    }
    let kept = [];
    try {
        kept = JSON.parse(fs.readFileSync(control_tokens_path(app), 'utf8'));
    }
    catch {
        kept = [];
    }
    app.control_tokens = (Array.isArray(kept) ? kept.filter(token_valid) : []);
    return app.control_tokens;
}

function token_valid(token)
{
    return (token !== null) && (typeof token === 'object') && (typeof token.id === 'string') && (typeof token.sha256 === 'string') && Array.isArray(token.remotes) && Array.isArray(token.reads);
}

module.exports = control_tokens_read;
