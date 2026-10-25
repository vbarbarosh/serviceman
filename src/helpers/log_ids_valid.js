// A line's group is a uid (log_uid) and its sender a word: a machine's line whose ids are of
// another shape, a bracket or a space in them, would be a line of another shape in the file
const RE_GROUP = /^c[0-9a-z]{11}$/;
const RE_SENDER = /^[a-z_][a-z0-9_]*$/;

function log_ids_valid(group, sender)
{
    return RE_GROUP.test(group) && RE_SENDER.test(sender);
}

module.exports = log_ids_valid;
