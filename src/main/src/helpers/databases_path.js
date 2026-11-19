const path = require('path');

// Where the database servers are kept: each one's machine, its engine, its root password and
// the users it made. Beside what serviceman writes about itself, never in the config: it holds
// the passwords.
function databases_path(app)
{
    return path.resolve(app.state_dir, 'databases.json');
}

module.exports = databases_path;
