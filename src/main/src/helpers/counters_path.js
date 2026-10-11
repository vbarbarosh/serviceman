const path = require('path');

// Where the counters are kept: beside what serviceman writes about itself, so a restart picks
// up where the last process left off
function counters_path(app)
{
    return path.resolve(app.state_dir, 'counters.json');
}

module.exports = counters_path;
