const docker_shell = require('./docker_shell');

// `.Config.Image` is the name the container was made from; `.Image` is the image itself, which
// stays what it was when the name moves on
const FORMAT = '{{.State.Running}}|{{.Config.Image}}|{{index .Config.Labels "serviceman.service"}}|{{index .Config.Labels "serviceman.spec"}}|{{.Image}}';

// What docker knows about the container right now; a missing container is a normal answer
async function docker_inspect(app, remote, container_name)
{
    const answer = await docker_shell(app, remote, ['inspect', '--format', FORMAT, container_name]);
    if (answer.ok === false) {
        return {exists: false, running: false, image: null, label: null, spec: null, image_id: null};
    }
    const parts = answer.stdout.split('|');
    return {
        exists: true,
        running: parts[0] === 'true',
        image: parts[1] || null,
        label: parts[2] || null,
        spec: parts[3] || null,
        image_id: (parts[4] || '').trim() || null,
    };
}

module.exports = docker_inspect;
