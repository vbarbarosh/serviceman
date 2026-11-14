const agent_reset = require('./agent_reset');
const socket_place = require('./socket_place');

// An external service on a machine of ours is reached through that machine's link, and one on
// a socket file in that file: its copy gets the pool that dials so, once the machines are known
function externals_attach(app, services)
{
    for (const service of services) {
        if (service.type !== 'external') {
            continue;
        }
        // A socket of serviceman's own side is said the way its cards say it: data/sockets/va.sock
        if ((service.upstream.socket !== undefined) && (service.remotes.length === 0)) {
            service.upstream.said = socket_place(app, service.upstream.socket).said;
        }
        for (const instance of service.state.instances) {
            if ((instance.remote !== null) || (service.upstream.socket !== undefined)) {
                agent_reset(app, service, instance);
            }
        }
    }
}

module.exports = externals_attach;
