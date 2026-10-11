const docker_container_name = require('./docker_container_name');
const docker_shell = require('./docker_shell');
const format_seconds = require('../../../helpers/format_seconds');
const log_event = require('./log_event');
const log_words = require('../../../helpers/log_words');

// What docker itself gives a container, and what serviceman gives one when nothing else is said
const STOP_TIMEOUT_MS = 10000;

// `--timeout`, not `--time`: the old spelling still works and prints a deprecation line every
// time a container stops. It is the docker of version 25 and newer that knows this one.
//
// Stops the container and keeps it, so the next start is a plain 'docker start' and the logs stay
async function docker_stop(app, remote, service, slot)
{
    const container_name = docker_container_name(service, slot);
    const timeout_ms = ((service.policy.stop_timeout_ms === null) ? STOP_TIMEOUT_MS : service.policy.stop_timeout_ms);
    const seconds = Math.max(1, Math.round(timeout_ms/1000));
    const time0 = Date.now();
    const answer = await docker_shell(app, remote, ['stop', '--timeout', String(seconds), container_name]);
    if ((answer.ok === false) && (answer.stderr.includes('No such container') === false)) {
        throw new Error(`docker stop failed: ${answer.stderr}`);
    }
    // docker asks the container to stop, waits, and kills it. Taking the whole wait means the
    // program inside never acted on the signal — a shell chain that drops it, most likely, and
    // then every stop of this service costs the full timeout.
    // See notes/signals-through-a-process-chain.md.
    if (Date.now() - time0 >= timeout_ms) {
        const words = {service: service.name, container: container_name, note: 'it was asked to stop and did not, so docker killed it'};
        log_event(app, 'container_killed', `${format_seconds(Date.now() - time0)} ${log_words(words)}`);
    }
}

module.exports = docker_stop;
