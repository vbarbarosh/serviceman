const log_group = require('./log_group');
const log_scope = require('./log_scope');

// A group whose parent is named, not the one that happens to be running. A request is caused by
// the connection it arrived on, and by nothing else this end was busy with, so the work is run
// under that connection's group.
//
// With no parent — work nothing above it caused — the group is a root and starts a trace of
// its own.
function log_group_from(parent, fn)
{
    // Nothing above it is carried as undefined, never as null: a group is a child or it is not
    return log_scope.run((parent === null) ? undefined : parent, () => log_group(fn));
}

module.exports = log_group_from;
