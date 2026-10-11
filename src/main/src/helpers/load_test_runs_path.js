const path = require('path');

function load_test_runs_path(app)
{
    return path.resolve(app.state_dir, 'load_test_runs.json');
}

module.exports = load_test_runs_path;
