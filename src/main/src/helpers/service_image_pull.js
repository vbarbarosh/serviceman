const docker_container_name = require('./docker_container_name');
const docker_inspect = require('./docker_inspect');
const docker_shell = require('./docker_shell');
const format_seconds = require('../../../helpers/format_seconds');
const log_event = require('./log_event');
const remote_from_instance = require('./remote_from_instance');
const remote_reserve = require('./remote_reserve');
const service_ensure_running = require('./service_ensure_running');
const service_phase = require('./service_phase');
const service_said = require('./service_said');
const service_stop = require('./service_stop');
const shell_progress_docker_pull = require('./shell_progress_docker_pull');

// The image again, from where it came from. A tag is not a version: `:latest` — or `:24`, or
// anything else somebody pushes over — is a name for whatever was published under it last, and
// a machine that already has something by that name never asks again. This is the ask.
//
// A newer image is no use in a container made from the older one, so what is running is made
// again from what just came down. Nothing else about the service changes: the same command,
// the same storage, the same address.
//
// Whether a container is old is asked of the container, not of the pull: the newer image may
// have come down before this — a docker pull by hand on that machine — and a pull that brings
// nothing new still finds a container made from an image the name no longer stands for.
async function service_image_pull(app, service)
{
    if (service.type !== 'docker') {
        throw new Error(`${service.name} is not made from an image — there is nothing to pull`);
    }
    const instance = service.state.instances[0];
    const remote = (instance.remote === null) ? remote_reserve(app, service, instance, []) : remote_from_instance(app, service, instance);
    const time0 = Date.now();
    const was = await image_id(app, remote, service.image);
    const running = (service_phase(service) === 'running');
    log_event(app, 'service_pull_begin', {service: service.name, image: service.image, remote: remote.name, was});
    // A pull is minutes, and the page says so for every one of them
    service.state.doing = `fetching ${service.image}`;
    service.state.said = [];
    try {
        const pulled = await shell_progress_docker_pull(app, remote, service);
        if (pulled.ok === false) {
            throw new Error(`docker pull failed: ${last_line(pulled)}`);
        }
        const now = await image_id(app, remote, service.image);
        const fresh = (now !== was);
        const behind = await containers_behind(app, remote, service, now);
        if (fresh || behind) {
            // The containers are of an older image, whatever the tag says now
            await containers_forget(app, remote, service, running);
        }
        log_event(app, 'service_pull_end_ok', {service: service.name, image: service.image, remote: remote.name, fresh, behind, took: format_seconds(Date.now() - time0)});
        service_said(app, {service: service.name, text: pull_text(service, fresh, behind, running)});
        return {image: service.image, remote: remote.name, fresh, remade: fresh || behind, id: now};
    }
    catch (error) {
        service.state.last_error = error.message;
        log_event(app, 'service_pull_end_error', {service: service.name, image: service.image, remote: remote.name, reason: error.message, took: format_seconds(Date.now() - time0)});
        throw error;
    }
    finally {
        service.state.doing = null;
    }
}

// Whether any container of the service was made from another image than the name stands for
// now. A container that is not there is not behind: the next start makes it from the new one.
async function containers_behind(app, remote, service, now)
{
    if (now === null) {
        return false;
    }
    for (const instance of service.state.instances) {
        const found = await docker_inspect(app, remote, docker_container_name(service, instance.slot));
        if (found.exists && (found.image_id !== null) && (found.image_id !== now)) {
            return true;
        }
    }
    return false;
}

function pull_text(service, fresh, behind, running)
{
    if (fresh) {
        return `a newer ${service.image} is here${running ? ', and it is running it' : ''}`;
    }
    if (behind) {
        return `${service.image} was already the newest one, but the container was made from an older one — it is made again${running ? ' and running' : ''}`;
    }
    return `${service.image} was already the newest one, and the container is made from it`;
}

// What is running is stopped, its containers are taken away so the next start makes them from
// the image that just came down, and a service that was running is running again at the end.
// One that was stopped is left stopped: nobody asked for it to be up. A container that would
// not go is said, not passed over: left there, it would be started again from the old image.
async function containers_forget(app, remote, service, running)
{
    if (running) {
        await service_stop(app, service, 'a newer image came down');
    }
    for (const instance of service.state.instances) {
        const name = docker_container_name(service, instance.slot);
        const removed = await docker_shell(app, remote, ['rm', '--force', name]);
        if ((removed.ok === false) && (/no such container/i.test(removed.stderr) === false)) {
            throw new Error(`docker rm ${name} failed: ${removed.stderr.trim()}`);
        }
    }
    if (running) {
        await service_ensure_running(app, service);
    }
}

// The image docker has under that name right now, or null where it has none. Two of these are
// what says whether the pull brought anything: a tag that moved is the whole point of asking.
async function image_id(app, remote, image)
{
    const said = await docker_shell(app, remote, ['image', 'inspect', '--format', '{{.Id}}', image]);
    return said.ok ? said.stdout.trim() : null;
}

function last_line(answer)
{
    const said = `${answer.stderr || ''}${answer.stdout || ''}`.trim().split('\n');
    return said[said.length - 1];
}

module.exports = service_image_pull;
