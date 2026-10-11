const log_event = require('./log_event');
const remote_call = require('./remote_call');
const volume_keep_root = require('./volume_keep_root');

// A bind mount whose folder is missing is created by docker as root; the agent makes it first,
// on the machine that will run the container
async function volume_paths_create(app, remote, service)
{
    for (const volume of service.volumes) {
        if (volume.create === false) {
            continue;
        }
        // A path this service keeps is under the folder of whoever runs it; that end knows
        // where its own folder is, so it makes it there
        const source = ((volume.kind === 'kept') ? kept_path(app, remote, volume) : volume.source);
        if ((source === null) || (await dir_made(app, remote, source) === false)) {
            continue;
        }
        log_event(app, 'volume_create', {service: service.name, path: source, target: volume.target, remote: remote.name});
    }
}

// A folder a service keeps, on the machine that will run it
function kept_path(app, remote, volume)
{
    const root = volume_keep_root(app, remote);
    return ((root === null) ? null : require('path').join(root, 'data', volume.keep));
}

// Makes the folder where the container will run, and says whether it had to
async function dir_made(app, remote, dir)
{
    const answer = await remote_call(app, remote, 'dir_create', {path: dir});
    return answer.created;
}

module.exports = volume_paths_create;
