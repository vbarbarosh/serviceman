const docker_exec_connect = require('./docker_exec_connect');
const engine_json = require('./engine_json');

const WAIT_MS = 90*1000;
const STEP_MS = 3000;

// After an upgrade, everything that ran before it runs again. An upgrade of Docker restarts it
// and an upgrade of a library restarts what uses it; what Docker does not bring back on its
// own is started here. What cannot start is named, with Docker's reason, so the upgrade ends
// saying so instead of looking done.
//
//     before   remote_containers_running, taken before the upgrade
//     answer   {started: [name], down: [{name, reason}]}
async function remote_containers_restore(app, remote, before)
{
    const out = {started: [], down: []};
    const now = await running_ids(app, remote);
    if (now === null) {
        out.down = before.map(v => ({name: v.name, reason: `Docker on ${remote.name} did not answer within ${WAIT_MS/1000}s of the upgrade`}));
        return out;
    }
    const connect = docker_exec_connect(app, remote);
    for (const item of before) {
        if (now.includes(item.id)) {
            continue;
        }
        try {
            await engine_json(connect, 'POST', `/containers/${encodeURIComponent(item.id)}/start`);
            out.started.push(item.name);
        }
        catch (error) {
            out.down.push({name: item.name, reason: error.message});
        }
    }
    return out;
}

// Docker restarted by the upgrade comes back in its own time: it is asked until it answers
async function running_ids(app, remote)
{
    const until = Date.now() + WAIT_MS;
    while (Date.now() < until) {
        try {
            const list = await engine_json(docker_exec_connect(app, remote), 'GET', '/containers/json');
            return list.map(v => v.Id);
        }
        catch {
            await new Promise(v => setTimeout(v, STEP_MS));
        }
    }
    return null;
}

module.exports = remote_containers_restore;
