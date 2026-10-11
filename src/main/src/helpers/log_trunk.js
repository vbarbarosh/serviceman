const log_group = require('./log_group');
const log_scope = require('./log_scope');

// The first group of the process, and the only one with nothing above it. Every other group is
// a child of this one — a connection, a timer, the boot itself — so any uid in the file walks
// up, one step at a time, to the moment serviceman started.
function log_trunk(app, fn)
{
    return log_scope.exit(function () {
        return log_group(function (group) {
            app.log_group = group;
            return fn(group);
        });
    });
}

module.exports = log_trunk;
