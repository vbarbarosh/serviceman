const path = require('path');

// Where the whole output of one run is kept
function load_test_log_path(app, id)
{
    return path.resolve(app.state_dir, 'load_test_logs', `${id}.log`);
}

module.exports = load_test_log_path;
