const log_scope = require('./log_scope');

// Work that belongs to a group which already exists. Not everything deserves a group of its
// own: one that holds a single line is a uid that never appears twice, and a uid that never
// appears twice is a line number with extra steps.
function log_within(group, fn)
{
    return log_scope.run(((group === undefined) || (group === null)) ? undefined : group, fn);
}

module.exports = log_within;
