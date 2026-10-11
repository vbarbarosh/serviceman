const docker_argv_from_service = require('./docker_argv_from_service');
const docker_container_name = require('./docker_container_name');
const docker_inspect = require('./docker_inspect');
const docker_shell = require('./docker_shell');
const docker_spec_hash = require('./docker_spec_hash');
const docker_upstream = require('./docker_upstream');
const image_pull = require('./image_pull');
const log_event = require('./log_event');
const service_said = require('./service_said');
const volume_keep_root = require('./volume_keep_root');
const volume_paths_create = require('./volume_paths_create');

// Starts the container for a service and answers with the address it is reachable at
async function docker_start(app, remote, service, slot)
{
    const container_name = docker_container_name(service, slot);
    const found = await docker_inspect(app, remote, container_name);
    if (found.exists && (found.label === service.name) && (found.spec !== docker_spec_hash(service))) {
        log_event(app, 'docker_recreate', {service: service.name, container: container_name, remote: remote.name});
        service_said(app, {service: service.name, text: 'the definition changed — the old container is taken away first'});
        await docker_shell(app, remote, ['rm', '--force', container_name]);
        found.exists = false;
        found.running = false;
    }
    if (found.exists === false) {
        const keep_root = volume_keep_root(app, remote);
        if ((keep_root === null) && (service.volumes.some(v => v.kind === 'kept') === true)) {
            throw new Error(`${service.name} keeps folders of its own, and the agent on ${remote.name} does not say where it keeps things — run bin/update on that machine`);
        }
        await volume_paths_create(app, remote, service);
        await image_pull(app, remote, service, true);
        log_event(app, 'docker_run', {service: service.name, image: service.image, remote: remote.name});
        // The image is fetched by this very command when it is not on the machine yet, which
        // is where the minutes of a first start go. Everything it prints is said as it prints.
        service_said(app, {service: service.name, text: `making the container from ${service.image}`});
        const created = await docker_shell(app, remote, docker_argv_from_service(service, slot, keep_root), service.name);
        if (created.ok === false) {
            throw new Error(`docker run failed: ${created.stderr}`);
        }
    }
    else if (found.running === false) {
        log_event(app, 'docker_start', {service: service.name, container: container_name, remote: remote.name});
        service_said(app, {service: service.name, text: 'starting the container that is already here'});
        const started = await docker_shell(app, remote, ['start', container_name], service.name);
        if (started.ok === false) {
            throw new Error(`docker start failed: ${started.stderr}`);
        }
    }
    const out = await docker_upstream(app, remote, service, slot);
    if (out === null) {
        throw new Error(`container ${container_name} publishes no port ${service.port}`);
    }
    return out;
}

module.exports = docker_start;
