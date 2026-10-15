const path = require('path');

// Where what the forwards carried is kept, beside the counters of the services
function forward_totals_path(app)
{
    return path.resolve(app.state_dir, 'forward_totals.json');
}

module.exports = forward_totals_path;
