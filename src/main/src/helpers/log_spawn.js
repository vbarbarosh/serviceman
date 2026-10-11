const log_line = require('./log_line');

// A group appears in the file the moment it has something to say, and never before: the line
// that names its parent comes first, and the groups above it come before that — so a uid is
// never mentioned without being explained, and a group that says nothing is never written.
//
// `group_spawn` is the first event of every group. A root group has no `parent=`.
function log_spawn(app, group)
{
    if (group.spawned) {
        return;
    }
    group.spawned = true;
    if (group.parent === null) {
        log_line(app, group.uid, 'group_spawn', undefined);
        return;
    }
    log_spawn(app, group.parent);
    log_line(app, group.uid, 'group_spawn', {parent: group.parent.uid});
}

module.exports = log_spawn;
