const path = require('path');

// Where the tokens Logline issued are kept: beside the secrets, never in the config
function logline_tokens_path(app)
{
    return path.resolve(app.state_dir, 'logline_tokens.json');
}

module.exports = logline_tokens_path;
