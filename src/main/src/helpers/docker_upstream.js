const docker_container_name = require('./docker_container_name');
const docker_shell = require('./docker_shell');
const upstream_from_text = require('./upstream_from_text');

// Where the published port of a running container landed on the machine that runs it
async function docker_upstream(app, remote, service, slot)
{
    const container_name = docker_container_name(service, slot);
    const answer = await docker_shell(app, remote, ['port', container_name, `${service.port}/tcp`]);
    if (answer.ok === false) {
        return null;
    }
    return upstream_from_text(answer.stdout);
}

module.exports = docker_upstream;
