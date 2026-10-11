const path = require('path');

// Where the secrets are kept: beside what serviceman writes about itself, never in the config.
// The config is read by the control page, printed in the log and kept in a repo; a secret is
// none of those things.
function secrets_path(app)
{
    return path.resolve(app.state_dir, 'secrets.json');
}

module.exports = secrets_path;
