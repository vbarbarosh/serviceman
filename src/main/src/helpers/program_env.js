// What a program finds in its environment besides serviceman's own: the port it is to listen
// on as PORT, written once in the config as publish.port, and whatever the service names,
// which wins over it
function program_env(service)
{
    const port = (service.port === null) ? {} : {PORT: String(service.port)};
    return Object.assign(port, service.env);
}

module.exports = program_env;
