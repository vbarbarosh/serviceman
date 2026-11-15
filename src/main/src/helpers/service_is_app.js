const service_app_folder = require('./service_app_folder');

// Whether a service is an app, one of those Apps shows: a folder of files, an app folder run as
// bin/run, a program on a socket. Each has its names under the apps domain and a port of its own.
function service_is_app(service)
{
    if (service.type === 'files') {
        return true;
    }
    if (service_app_folder(service) !== null) {
        return true;
    }
    return (service.type === 'external') && (service.upstream !== undefined) && (service.upstream !== null) && (service.upstream.socket !== undefined);
}

module.exports = service_is_app;
