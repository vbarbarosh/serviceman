const docker_exec_connect = require('./docker_exec_connect');
const engine_json = require('./engine_json');
const problems_from_containers = require('./problems_from_containers');
const remote_call = require('./remote_call');

// Sources a machine's agent is not meant to see, or that are not files of the machine's own
const SOURCES_SKIPPED = /^\/(proc|sys|dev|run|var\/run|var\/lib\/docker)(\/|$)/;

// What is wrong with one connected machine's containers, asked of its Docker and its disk: the
// containers that are not running, inspected, and the files the running ones mount, each
// looked for. A machine with no Docker its agent can reach has nothing to say here.
//
//     out   {problems, seen}: seen [[key, {state, text, detail}]], the containers counted
async function problems_of_remote(app, remote)
{
    let connect;
    try {
        connect = docker_exec_connect(app, remote);
    }
    catch {
        return {problems: [], seen: []};
    }
    const list = await engine_json(connect, 'GET', '/containers/json?all=1');
    const inspect = {};
    const gone = [];
    for (const item of list) {
        if (item.State !== 'running') {
            inspect[item.Id] = await engine_json(connect, 'GET', `/containers/${encodeURIComponent(item.Id)}/json`);
            continue;
        }
        for (const mount of (item.Mounts || [])) {
            if ((mount.Type !== 'bind') || SOURCES_SKIPPED.test(mount.Source)) {
                continue;
            }
            if (await missing(app, remote, mount.Source)) {
                gone.push({id: item.Id, source: mount.Source});
            }
        }
    }
    const running = list.filter(v => v.State === 'running').length;
    const rest = list.length - running;
    const text = `${running} running${(rest === 0) ? '' : `, ${rest} not`}`;
    return {problems: problems_from_containers(remote.name, list, inspect, gone), seen: [[`docker:${remote.name}`, {state: 'ok', text, detail: 'Every container Docker is meant to keep running runs, and the files they mount are there.'}]]};
}

// Only a name that is not there counts: one the agent may not open is somebody else's
async function missing(app, remote, path)
{
    try {
        await remote_call(app, remote, 'fs_stat', {path});
        return false;
    }
    catch (error) {
        return /ENOENT/.test(error.message);
    }
}

module.exports = problems_of_remote;
