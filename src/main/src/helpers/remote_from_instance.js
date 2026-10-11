const remote_candidates = require('./remote_candidates');

// The machine an instance was reserved on. Everything after the start asks this, never the
// service's list: the list says where it may run, the instance says where it does.
function remote_from_instance(app, service, instance)
{
    if (instance.remote === null) {
        // Nothing is reserved yet — the first machine it may run on is the one to ask
        const out = remote_candidates(app, service)[0];
        if (out === undefined) {
            throw new Error(`${service.name}: nothing in the config answers ${service.remotes.join(', ')}`);
        }
        return out;
    }
    const out = app.remote_by_name[instance.remote];
    if (out === undefined) {
        throw new Error(`${service.name}: no remote named ${instance.remote} is in the config`);
    }
    return out;
}

module.exports = remote_from_instance;
