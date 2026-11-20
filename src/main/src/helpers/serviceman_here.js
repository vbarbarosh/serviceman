// Whether serviceman itself runs on this machine, as its last Security look found it: its own
// container among the ones running there. The Updates page says so before Install is pressed,
// since that machine goes last, alone; Install itself asks the machines again (own_remote).
// False before a look, and where serviceman runs outside docker.
//
//     app       {own_container, security: {seen}}
//     remote    {name}
//     ->        true or false
function serviceman_here(app, remote)
{
    if ((app.own_container === null) || (app.own_container === undefined) || (app.security === undefined)) {
        return false;
    }
    const seen = app.security.seen.get(remote.name);
    const docker = ((seen === undefined) || (seen.facts === null) || (seen.facts === undefined)) ? null : seen.facts.docker;
    return (docker !== null) && (docker !== undefined) && Array.isArray(docker.ids) && docker.ids.includes(app.own_container);
}

module.exports = serviceman_here;
