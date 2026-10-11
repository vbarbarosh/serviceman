const crypto = require('crypto');
const volume_text = require('../../../helpers/volume_text');

const HASH_LENGTH = 12;

// The shape of the `docker run` line itself. The fields below say what a container is made
// of; this says how serviceman makes one. Bump it when the argv builders change in a way
// every container must pick up — `--init` was the first — and every container that exists
// becomes old at once, to be replaced on its next start. That replacement is the point:
// without the bump, a flag added to the builders reaches only containers that happen to be
// recreated for their own reasons, and the rest run without it forever.
const LINE_VERSION = 2;

// Everything that is fixed when the container is created; a new value means the container is old
function docker_spec_hash(service)
{
    const volumes = [];
    for (const volume of ((service.volumes === undefined) ? [] : service.volumes)) {
        volumes.push(volume_text(volume));
    }
    const spec = {
        line: LINE_VERSION,
        image: service.image,
        port: service.port,
        env: service.env,
        volumes,
        network: ((service.network === undefined) ? null : service.network),
        run_args: ((service.run_args === undefined) ? [] : service.run_args),
        args: ((service.args === undefined) ? [] : service.args),
    };
    // A shell service that names an image has none of the fields a docker service is made of
    // but the image and the port, and one more that decides its container: the line it runs.
    // It is added only for those, because a key that appears for everybody changes the hash of
    // every container that already exists — and a container whose hash changed is destroyed.
    if (service.type === 'shell') {
        spec.command = service.command;
    }
    // Only where the init is left out, for the same reason: everybody else keeps their hash
    if (service.init === false) {
        spec.init = false;
    }
    return crypto.createHash('sha1').update(JSON.stringify(spec)).digest('hex').slice(0, HASH_LENGTH);
}

module.exports = docker_spec_hash;
