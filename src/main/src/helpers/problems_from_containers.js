const KEEP_RUNNING = ['always', 'unless-stopped', 'on-failure'];

// The containers of one machine Docker was meant to keep running and does not (one someone
// stopped is not among them, however its program ended), and the running ones that will not
// start again: a file they mount is gone from the machine, and they live on only on what they
// hold open until Docker or the machine restarts. serviceman's own containers are left to
// their service pages.
//
//     list      GET /containers/json?all=1
//     inspect   {id: GET /containers/<id>/json} for the ones not running
//     gone      [{id, source}]: a bind mount of a running container whose source is not there
function problems_from_containers(remote, list, inspect, gone)
{
    const out = [];
    for (const item of list) {
        const name = name_of(item);
        if (name.startsWith('serviceman-')) {
            continue;
        }
        const full = inspect[item.Id];
        if ((item.State !== 'running') && (full !== undefined) && failed(full)) {
            out.push(problem_failed(remote, name, full));
        }
        const missing = gone.filter(v => v.id === item.Id).map(v => v.source);
        if ((item.State === 'running') && (missing.length > 0)) {
            out.push({
                key: `files_gone:${remote}:${name}`,
                kind: 'container',
                remote,
                subject: `${name} will not start again after a restart`,
                cause: `${plural(missing.length, 'a file it mounts is', 'files it mounts are')} gone from ${remote}: ${missing.join(', ')}`,
                fix: 'Put them back. It runs on what it holds open, until Docker or the machine restarts; then Docker makes empty folders in their place and it cannot start.',
                since: null,
            });
        }
    }
    return out;
}

function failed(full)
{
    const state = full.State;
    const policy = (full.HostConfig && full.HostConfig.RestartPolicy) ? full.HostConfig.RestartPolicy : {Name: ''};
    if (KEEP_RUNNING.includes(policy.Name) === false) {
        return false;
    }
    if (state.Status === 'restarting') {
        return true;
    }
    if (state.Status !== 'exited') {
        return false;
    }
    if (state.Error !== '') {
        return true;
    }
    // Docker starts an exited one again by its policy until someone stops it, so one left
    // exited was stopped by hand, whatever code its program ended with; only on-failure:N gives
    // up, after N failures in a row
    const max = policy.MaximumRetryCount || 0;
    return (policy.Name === 'on-failure') && (max > 0) && (state.ExitCode !== 0) && ((full.RestartCount || 0) >= max);
}

function problem_failed(remote, name, full)
{
    const state = full.State;
    const mount = /error mounting "([^"]+)"/.exec(state.Error || '');
    const since = Date.parse(state.FinishedAt);
    return {
        key: `container_down:${remote}:${name}`,
        kind: 'container',
        remote,
        subject: `${name} is down on ${remote}`,
        cause: cause_of(full, mount),
        fix: (mount !== null) ? `Put ${mount[1]} back (Docker leaves an empty folder where a file was), then: docker start ${name}` : `docker logs ${name} says why; once that is mended: docker start ${name}`,
        since: (Number.isFinite(since) && (since > 0)) ? since : null,
    };
}

function cause_of(full, mount)
{
    const state = full.State;
    if (state.Status === 'restarting') {
        return `it keeps failing: Docker restarts it again and again (exit ${state.ExitCode})`;
    }
    if (mount !== null) {
        return `Docker cannot start it: ${mount[1]} is not there as it was (exit ${state.ExitCode})`;
    }
    if (state.Error !== '') {
        return `Docker cannot start it: ${state.Error}`;
    }
    return `it failed ${full.RestartCount} times in a row (exit ${state.ExitCode}), and Docker stopped trying, as its restart policy says`;
}

function name_of(item)
{
    return (Array.isArray(item.Names) && (item.Names.length > 0)) ? item.Names[0].replace(/^\//, '') : item.Id.slice(0, 12);
}

function plural(n, one, many)
{
    return (n === 1) ? one : many;
}

module.exports = problems_from_containers;
