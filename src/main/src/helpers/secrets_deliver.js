const remote_call = require('./remote_call');
const secrets_of_service = require('./secrets_of_service');

// Puts the secrets a service may see on the machine that runs it, and answers with where they
// landed there. A service that names none gets nothing at all — no file, no command, nothing
// to read — which is the only way to be sure it read nothing.
async function secrets_deliver(app, remote, service)
{
    const secrets = secrets_of_service(app, service);
    if (Object.keys(secrets).length === 0) {
        return null;
    }
    return await remote_call(app, remote, 'secrets_put', {service: service.name, secrets});
}

module.exports = secrets_deliver;
