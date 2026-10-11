const docker_container_name = require('./docker_container_name');
const docker_inspect = require('./docker_inspect');
const docker_spec_hash = require('./docker_spec_hash');
const docker_upstream = require('./docker_upstream');

// Adopts a container that is already running — after a serviceman restart, nothing is stopped twice.
// A container of another definition is not adopted; the next start replaces it.
async function docker_probe(app, remote, service, slot)
{
    const found = await docker_inspect(app, remote, docker_container_name(service, slot));
    if ((found.running === false) || (found.spec !== docker_spec_hash(service))) {
        return null;
    }
    return await docker_upstream(app, remote, service, slot);
}

module.exports = docker_probe;
