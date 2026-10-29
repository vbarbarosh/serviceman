// A machine's state as the colour of its dot and its pill: running while it answers, starting
// while what it was asked has waited past a few seconds for an answer (its link up all the
// same), failed while it is away
function remote_dot(remote)
{
    if (remote.phase !== 'online') {
        return 'failed';
    }
    return ((remote.unanswered === null) || (remote.unanswered === undefined)) ? 'running' : 'starting';
}

export default remote_dot;
