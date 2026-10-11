// A sender is the rules' own: snake_case, so a bracketed word in someone's output — a level, a
// thread name, a quoted piece of code — is not taken for one
const RE_LINE = /^\[([^\]\s]+)\]\[([a-z_][a-z0-9_]*)\](?: (.*))?$/;
const RE_PARENT = /^parent=(\S+)/;

// A line in the rules' form -> its fields, the way LogAttributes keeps them; any other line ->
// nothing, and nothing is guessed from it
function line_fields(line)
{
    const found = RE_LINE.exec(line);
    if (found === null) {
        return {};
    }
    const out = {group_uid: found[1], sender: found[2]};
    if ((found[3] !== undefined) && (found[3] !== '')) {
        out.details = found[3];
    }
    if ((found[2] === 'group_spawn') && (found[3] !== undefined)) {
        const parent = RE_PARENT.exec(found[3]);
        if (parent !== null) {
            out.parent_group_uid = parent[1];
        }
    }
    return out;
}

module.exports = line_fields;
