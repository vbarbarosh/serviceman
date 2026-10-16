const docker_exec_connect = require('./docker_exec_connect');
const engine_json = require('./engine_json');

// The containers running on a machine now, {id, name} each, for what has to be running again
// once an upgrade is over; null where its agent reaches no Docker
async function remote_containers_running(app, remote)
{
    let connect;
    try {
        connect = docker_exec_connect(app, remote);
    }
    catch {
        return null;
    }
    const list = await engine_json(connect, 'GET', '/containers/json');
    return list.map(v => ({id: v.Id, name: (Array.isArray(v.Names) && (v.Names.length > 0)) ? v.Names[0].replace(/^\//, '') : v.Id.slice(0, 12)}));
}

module.exports = remote_containers_running;
