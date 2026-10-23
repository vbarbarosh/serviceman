const docker_container_name = require('./docker_container_name');
const docker_inspect = require('./docker_inspect');
const docker_shell = require('./docker_shell');
const docker_spec_hash = require('./docker_spec_hash');
const docker_upstream = require('./docker_upstream');
const image_pull = require('./image_pull');
const log_event = require('./log_event');
const program_env = require('./program_env');
const remote_call = require('./remote_call');
const service_said = require('./service_said');
const volume_paths_create = require('./volume_paths_create');

const START_TIMEOUT_MS = 600000;

// A shell service that names an image runs inside one: a container of the same shape every
// other serviceman container has, with the program's folder mounted and the command as its
// command. Everything after this — stopping it, finding it again, its output — is the docker
// driver, because by then it is an ordinary container of ours.
async function program_docker_start(app, remote, service, instance, secrets)
{
    const container = docker_container_name(service, instance.slot);
    const spec = docker_spec_hash(service);
    const found = await docker_inspect(app, remote, container);
    if (found.exists && (found.label === service.name) && (found.spec !== spec)) {
        log_event(app, 'docker_recreate', {service: service.name, container, remote: remote.name});
        await docker_shell(app, remote, ['rm', '--force', container]);
        found.exists = false;
        found.running = false;
    }
    if (found.exists === false) {
        await volume_paths_create(app, remote, service);
        await image_pull(app, remote, service, true);
        log_event(app, 'docker_run', {service: service.name, image: service.image, remote: remote.name});
        service_said(app, {service: service.name, text: `making the container from ${service.image}`});
        const made = await create(app, remote, service, instance, container, spec, secrets);
        if (made.ok === false) {
            throw new Error(`docker run failed: ${made.stderr}`);
        }
    }
    else if (found.running === false) {
        log_event(app, 'docker_start', {service: service.name, container, remote: remote.name});
        service_said(app, {service: service.name, text: 'starting the container that is already here'});
        const started = await docker_shell(app, remote, ['start', container], service.name);
        if (started.ok === false) {
            throw new Error(`docker start failed: ${started.stderr}`);
        }
    }
    const out = await docker_upstream(app, remote, service, instance.slot);
    if (out === null) {
        throw new Error(`container ${container} publishes no port ${service.port}`);
    }
    return out;
}

// The one step that needs a path on the machine that runs docker, so the machine builds it
function create(app, remote, service, instance, container, spec, secrets)
{
    return remote_call(app, remote, 'program_docker_start', {
        container,
        service: service.name,
        spec,
        cwd: service.cwd,
        image: service.image,
        user: service.user,
        command: service.command,
        env: program_env(service),
        port: service.port,
        volumes: service.volumes,
        secrets,
    }, START_TIMEOUT_MS);
}

module.exports = program_docker_start;
