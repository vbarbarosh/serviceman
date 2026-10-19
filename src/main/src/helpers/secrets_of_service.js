const secrets_read = require('./secrets_read');

// The secrets of one service, by the names its program asks for. They are its own — the
// library is a place to copy from, not a place a program reads.
function secrets_of_service(app, service)
{
    const kept = secrets_read(app).services[service.name];
    return (kept === undefined) ? {} : kept;
}

module.exports = secrets_of_service;
