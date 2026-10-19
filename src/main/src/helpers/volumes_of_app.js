// Everything the services keep, and where it is kept. There is no register apart from them: a
// thing is kept because a service keeps it, and it is on the one machine that service runs on.
function volumes_of_app(app)
{
    const out = [];
    for (const service of app.services) {
        for (const volume of ((service.volumes === undefined) ? [] : service.volumes)) {
            const machine = service.remotes[0];
            const name = name_of(volume);
            const found = out.find(v => (v.name === name) && (v.machine === machine));
            const user = {service: service.name, at: volume.target, readonly: volume.readonly};
            if (found === undefined) {
                out.push({name, kind: volume.kind, machine, used_by: [user]});
                continue;
            }
            found.used_by.push(user);
        }
    }
    return out;
}

// What it is called where it lives: a folder under the agent, a volume of docker's, a path
function name_of(volume)
{
    return (volume.kind === 'kept') ? `data/${volume.keep}` : volume.source;
}

module.exports = volumes_of_app;
