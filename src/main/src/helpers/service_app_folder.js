const path = require('path');

// The folder of an app folder service, or null: a program run as bin/run in a folder named in
// the config, which is what the New service form makes of a folder or a zip. Only such a
// folder takes a new version, because only it says where the app is and what in it is kept.
function service_app_folder(service)
{
    if ((service.type !== 'shell') || (service.command !== 'bin/run') || (service.cwd_made === true)) {
        return null;
    }
    if ((typeof service.cwd !== 'string') || (path.isAbsolute(service.cwd) === false)) {
        return null;
    }
    return service.cwd.replace(/\/+$/, '');
}

module.exports = service_app_folder;
