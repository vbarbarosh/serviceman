const docker_container_name = require('./docker_container_name');
const docker_shell = require('./docker_shell');
const remote_call = require('./remote_call');
const remote_from_instance = require('./remote_from_instance');

// The last lines the service itself wrote, for the page somebody is waiting on. A program's
// output is kept by the agent that holds it; a container's belongs to docker. Both are asked for.
async function service_tail(app, service, instance, lines)
{
    const text = await tail_text(app, service, instance, lines);
    const kept = [];
    for (const line of text.split('\n')) {
        if (line.trim() !== '') {
            kept.push(line);
        }
    }
    return kept.slice(-lines);
}

async function tail_text(app, service, instance, lines)
{
    if ((service.type === 'shell') && (service.image === null)) {
        const answer = await remote_call(app, remote_from_instance(app, service, instance), 'program_logs', {name: service.name, slot: instance.slot});
        return answer.text;
    }
    if ((service.type !== 'shell') && (service.type !== 'docker')) {
        return '';
    }
    const answer = await docker_shell(app, remote_from_instance(app, service, instance), ['logs', '--tail', String(lines), docker_container_name(service, instance.slot)]);
    if (answer.ok === false) {
        return '';
    }
    return `${answer.stdout}\n${answer.stderr}`;
}

module.exports = service_tail;
