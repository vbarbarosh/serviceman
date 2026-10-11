// Whether the agent over there can be asked for a feature. Its hello names what it has; an
// agent that names nothing is from before the naming, and can do none of the named things.
function remote_can(remote, feature)
{
    const resources = remote.state.resources;
    if ((resources === null) || (Array.isArray(resources.can) === false)) {
        return false;
    }
    return resources.can.includes(feature);
}

module.exports = remote_can;
