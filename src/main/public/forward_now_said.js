// Where a forward stands now, as the page says it wherever the forward is shown: on Forwards and
// on the page of the service it is part of. `word` is the word or two on its line, `dot` the
// dot's class, `bad` whether it is in the colour of an error, and `problem` what stands in its
// way in full where the word does not say it all, or null.
//
//     forward  a forward of the status (view_from_forward)
//     remotes  the machines of the status, for their titles
function forward_now_said(forward, remotes)
{
    const words = {
        ready: 'active',
        aside: 'set aside',
        old_agent: 'agent too old',
        telling: 'starting',
        from_offline: `${title_of(remotes, forward.from.remote)} offline`,
        cannot_listen: 'cannot listen',
        link_down: `${title_of(remotes, forward.to.remote)} link down`,
        to_offline: `${title_of(remotes, forward.to.remote)} offline`,
    };
    const word = (words[forward.state] === undefined) ? forward.state : words[forward.state];
    const bad = (['ready', 'aside', 'telling'].includes(forward.state) === false);
    // A machine offline says it all in its word, and a forward set aside has nothing in its way
    const said = (forward.problem !== null) && (forward.off === false) && (['from_offline', 'to_offline'].includes(forward.state) === false);
    return {word, dot: dot_of(forward.state), bad, problem: said ? forward.problem : null};
}

function dot_of(state)
{
    if (state === 'ready') {
        return 'running';
    }
    if (state === 'telling') {
        return 'starting';
    }
    return (state === 'aside') ? '' : 'failed';
}

function title_of(remotes, name)
{
    const found = remotes.find(v => v.name === name);
    return (found === undefined) ? name : (found.title || found.name);
}

export default forward_now_said;
