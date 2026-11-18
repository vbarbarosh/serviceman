// Where an app answers, as its PUT says it: at its name beside serviceman's own, on serviceman's
// own door, which the computer serviceman runs on opens with no DNS at all; and at its name
// under the apps domain, for outside, which a machine's door answers on its own port
//
//     {address, public}
//     address  http://notes.localhost:8080/; null for an app with no name at all
//     public   notes.apps.example.com, or null with no apps domain
function app_address_of(app, service)
{
    const domain = app.config.apps.domain;
    const hosts = service.hosts.map(v => v.split('/')[0]);
    const under = hosts.find(v => (domain !== null) && v.endsWith(`.${domain}`));
    const local = hosts.find(v => v !== under) || hosts[0];
    const port = ((app.listen_port === 80) || (app.listen_port === null)) ? '' : `:${app.listen_port}`;
    return {address: (local === undefined) ? null : `http://${local}${port}/`, public: (under === undefined) ? null : under};
}

module.exports = app_address_of;
