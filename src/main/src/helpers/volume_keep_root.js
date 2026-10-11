// Where the folders a service keeps live on the machine that runs it: inside the agent's
// directory — `<root>/data/<service>/<path>`.
//
// null means that machine has not said: an agent from before storage existed. The caller says
// so in its own words, because what is missing depends on what it was about to do.
function volume_keep_root(app, remote)
{
    const resources = remote.state.resources;
    if ((resources === null) || (resources === undefined) || (typeof resources.dir !== 'string')) {
        return null;
    }
    return resources.dir;
}

module.exports = volume_keep_root;
