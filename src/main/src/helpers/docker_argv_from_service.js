const docker_container_name = require('./docker_container_name');
const docker_spec_hash = require('./docker_spec_hash');
const volume_text = require('../../../helpers/volume_text');

const PUBLISHED_AT = '127.0.0.1';

// The 'docker run' command line for a service, without the docker binary itself: the agent
// that runs it puts its own docker in front. Published on a port docker picks, on the loopback
// of that machine — which is where the agent's tunnel reaches it.
function docker_argv_from_service(service, slot, keep_root)
{
    const out = ['run', '-d'];
    // docker's own init as pid 1: a program that is pid 1 itself never gets a signal it has
    // no handler for, and every stop of it costs the whole timeout. See
    // notes/signals-through-a-process-chain.md. An image that has to be pid 1 itself says so.
    if (service.init !== false) {
        out.push('--init');
    }
    out.push(
        '--name', docker_container_name(service, slot),
        '--label', `serviceman.service=${service.name}`,
        '--label', `serviceman.spec=${docker_spec_hash(service)}`,
        '--publish', `${PUBLISHED_AT}::${service.port}`,
    );
    for (const name of Object.keys(service.env)) {
        out.push('--env', `${name}=${service.env[name]}`);
    }
    for (const volume of service.volumes) {
        out.push('--volume', volume_text(volume, keep_root));
    }
    if (service.network !== null) {
        out.push('--network', service.network);
    }
    for (const item of service.run_args) {
        out.push(item);
    }
    out.push(service.image);
    for (const item of service.args) {
        out.push(item);
    }
    return out;
}

module.exports = docker_argv_from_service;
