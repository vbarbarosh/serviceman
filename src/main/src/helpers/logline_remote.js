// The machine Logline runs on: the one the service named logline is on, connected. Nothing to
// write in the config: the service already names it. What keeps it from being reached is
// said, in words the page shows.
function logline_remote(app)
{
    const service = app.service_by_name.logline;
    if (service === undefined) {
        throw new Error('no service is named logline: add Logline\'s viewer as an external service named logline, on the machine that runs it');
    }
    const name = (Array.isArray(service.remotes) && (service.remotes.length > 0)) ? service.remotes[0] : null;
    if (name === null) {
        throw new Error('the service logline names no machine: Logline runs on one, and the service says which');
    }
    if (name.startsWith('#')) {
        throw new Error(`the service logline names a tag, ${name}: Logline runs on one machine, and the service names it`);
    }
    const remote = app.remote_by_name[name];
    if ((remote === undefined) || (remote.state.phase !== 'online')) {
        throw new Error(`${name}, where Logline runs, is not connected`);
    }
    return remote;
}

module.exports = logline_remote;
