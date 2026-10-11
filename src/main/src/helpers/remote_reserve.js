const log_event = require('./log_event');
const remote_candidates = require('./remote_candidates');

// Picks the machine this instance will run on, and writes it down before anything starts, so
// everything that follows — the container, the logs, the shell, the stop — asks the same one.
// The service lists where it may run, in the order it prefers; the first one that is online
// takes it. Nothing is moved afterwards: an instance lives where it was reserved.
function remote_reserve(app, service, instance, refused)
{
    const skip = ((refused === undefined) ? [] : refused);
    const waiting = [];
    const candidates = remote_candidates(app, service);
    if (candidates.length === 0) {
        throw new Error(`${service.name}: nothing in the config answers ${service.remotes.join(', ')}`);
    }
    for (const remote of candidates) {
        if (skip.includes(remote.name)) {
            continue;
        }
        if (remote.state.phase !== 'online') {
            waiting.push(remote.name);
            continue;
        }
        instance.remote = remote.name;
        log_event(app, 'remote_reserved', {
            service: service.name,
            instance: instance.slot,
            remote: remote.name,
            of: service.remotes,
        });
        return remote;
    }
    instance.remote = null;
    if (waiting.length > 0) {
        throw new Error(`${service.name}: ${said(waiting)} offline — no machine to start it on`);
    }
    throw new Error(`${service.name}: every remote it may run on has already refused it`);
}

function said(names)
{
    if (names.length === 1) {
        return `remote ${names[0]} is`;
    }
    return `remotes ${names.join(', ')} are`;
}

module.exports = remote_reserve;
