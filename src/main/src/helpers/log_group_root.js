const log_group_from = require('./log_group_from');

// A group under the process itself: a connection a visitor opened, a signal, a timer. Whatever
// work was in flight when it was made did not cause it, and it says whose child it is like
// every other group.
function log_group_root(app, fn)
{
    return log_group_from(app.log_group, fn);
}

module.exports = log_group_root;
