// What a machine is, from both ends: the tags the config gives it, and the tags it says about
// itself while it is connected. The config's are facts — they stand whether the machine is up
// or not; the machine's are gone the moment its link is.
function remote_tags(remote)
{
    const out = remote.tags.slice();
    for (const tag of remote.state.declared) {
        if (out.includes(tag) === false) {
            out.push(tag);
        }
    }
    return out;
}

module.exports = remote_tags;
