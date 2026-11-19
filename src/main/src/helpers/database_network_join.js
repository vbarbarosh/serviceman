const database_up = require('./database_up');
const docker_shell = require('./docker_shell');

// A container put on the databases' network beside its own, to reach a server there by its
// name: one that is on it already is left as it is
async function database_network_join(app, remote, container)
{
    const joined = await docker_shell(app, remote, ['network', 'connect', database_up.NETWORK, container]);
    if ((joined.ok === false) && (/already|exists/i.test(joined.stderr) === false)) {
        throw new Error(`${container} could not join ${database_up.NETWORK}: ${joined.stderr.trim()}`);
    }
}

module.exports = database_network_join;
