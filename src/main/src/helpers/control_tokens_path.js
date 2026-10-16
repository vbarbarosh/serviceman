const path = require('path');

// Where the control tokens are kept: beside the secrets, never in the config. Only a hash of
// each is kept, so the file shows nobody a token that works.
function control_tokens_path(app)
{
    return path.resolve(app.state_dir, 'control_tokens.json');
}

module.exports = control_tokens_path;
