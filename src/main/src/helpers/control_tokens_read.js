const control_tokens_path = require('./control_tokens_path');
const fs = require('fs');

// Every token made for a caller of the control door, the owner's aside:
//
//     {id, label, sha256, remotes, rights, folders, services, apps_own, apps, made_at}
//
// remotes   the machines it sees, by name; ['*'] for every machine, those added later too
// rights    what it may do with them: the reads, status and metrics among them, terminals,
//           versions and forwards (control_route_right); a read alone, files_read,
//           forwards_read or apps_read, is held by the right it is under too, so a token made
//           before it was reads with files, forwards or apps as it did
// folders   the folders its files or files_read right is kept within, the first its start;
//           none without one
// services  the app folders its versions right is kept to, by name; none for every app folder
//           on its machines
// apps_own  true when its apps right is kept to the apps it makes: a new name, and those on
//           apps; false or missing for any app of files, as a token made before it had
// apps      the apps it made, by name, in the order it made them, kept to them or not
//           (control_token_app_made); missing until it makes one
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
    app.control_tokens = Array.isArray(kept) ? kept.filter(token_valid) : [];
    return app.control_tokens;
}

function token_valid(token)
{
    return (token !== null) && (typeof token === 'object') && (typeof token.id === 'string') && (typeof token.sha256 === 'string') && Array.isArray(token.remotes) && Array.isArray(token.rights);
}

module.exports = control_tokens_read;
