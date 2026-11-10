// A line's group is a uid (log_uid) and its sender a word: a machine's line whose ids are of
// another shape, a bracket or a space in them, would be a line of another shape in the file.
// A sender has a length too, 64 letters where the longest written has 26: the details of a
// line are cut to keep it under 2k bytes (log_line), its sender never is
const RE_GROUP = /^c[0-9a-z]{11}$/;
const RE_SENDER = /^[a-z_][a-z0-9_]{0,63}$/;

function log_ids_valid(group, sender)
{
    return RE_GROUP.test(group) && RE_SENDER.test(sender);
}

module.exports = log_ids_valid;
