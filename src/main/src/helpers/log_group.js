const log_scope = require('./log_scope');
const log_uid = require('../../../helpers/log_uid');

// Runs the work under a group of its own. A group made inside another says whose child it is
// on its first line, so any line can be walked back to what caused it, one step at a time.
// Nothing is written until the group has something to say.
function log_group(fn)
{
    const parent = log_scope.getStore();
    const group = {
        uid: log_uid(),
        parent: (parent === undefined) ? null : parent,
        spawned: false,
    };
    return log_scope.run(group, () => fn(group));
}

module.exports = log_group;
