const log_event = require('./log_event');
const remote_call = require('./remote_call');

// The folder of a program goes when the program does — but only the folder serviceman made.
// A folder named in the config is somebody's own, and stays whatever happens to the service.
async function program_folder_remove(app, remote, service)
{
    if (service.cwd_made !== true) {
        return false;
    }
    const answer = await remote_call(app, remote, 'program_remove', {cwd: service.cwd});
    if (answer.removed === false) {
        return false;
    }
    log_event(app, 'program_folder_removed', {service: service.name, cwd: service.cwd, remote: remote.name});
    return true;
}

module.exports = program_folder_remove;
