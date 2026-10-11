// Whether a machine runs the agent this host serves: true or false, or null where it cannot be
// told — a machine that is not connected says nothing now, and a host serving no build has
// nothing to compare with. An agent from before builds were dated is not the one served.
function agent_current(view, served)
{
    if ((view.phase !== 'online') || (served === null) || (served === undefined)) {
        return null;
    }
    return view.agent_built === served;
}

export default agent_current;
