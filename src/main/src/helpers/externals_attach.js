const agent_reset = require('./agent_reset');

// An external service on a machine of ours is reached through that machine's link: its copy
// gets the pool that dials through the link, once the machines are known
function externals_attach(app, services)
{
    for (const service of services) {
        if (service.type !== 'external') {
            continue;
        }
        for (const instance of service.state.instances) {
            if (instance.remote !== null) {
                agent_reset(app, service, instance);
            }
        }
    }
}

module.exports = externals_attach;
