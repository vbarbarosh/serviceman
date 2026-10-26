const path = require('path');

// Where the shared folders are kept: their home, its secrets, the folders and where each is
// mounted. Beside what serviceman writes about itself, never in the config: it holds the
// passwords of the home and the passphrase of the volume's key.
function shared_path(app)
{
    return path.resolve(app.state_dir, 'shared_folders.json');
}

module.exports = shared_path;
