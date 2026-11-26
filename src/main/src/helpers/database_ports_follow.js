const database_port_follow = require('./database_port_follow');
const database_root_held = require('./database_root_held');
const databases_read = require('./databases_read');
const log_event = require('./log_event');

// When each try is made after a machine comes online: its docker may start the servers' containers
// after its agent has dialled in, so a container not running yet is asked again
const TRIES_MS = [0, 15000, 60000, 180000];

// The database servers up on a machine that came online, each one's port read again and its
// forwards brought from it (database_port_follow): a machine that restarted, or its docker,
// gave each container a port of docker's picking again. Once its container answers, a MongoDB
// made before its root was held to its container is held now (database_root_held).
function database_ports_follow(app, remote)
{
    for (const server of databases_read(app).servers) {
        if ((server.remote === remote.name) && (server.phase === 'up')) {
            try_at(app, server.name, 0);
        }
    }
}

function try_at(app, name, index)
{
    const timer = setTimeout(async function () {
        let read = false;
        try {
            read = await database_port_follow(app, name);
        }
        catch (error) {
            log_event(app, 'database_port_error', {database: name, reason: error.message});
        }
        if (read === false) {
            if (index + 1 < TRIES_MS.length) {
                try_at(app, name, index + 1);
            }
            return;
        }
        try {
            await database_root_held(app, name);
        }
        catch (error) {
            log_event(app, 'database_root_error', {database: name, reason: error.message});
        }
    }, TRIES_MS[index]);
    timer.unref();
}

module.exports = database_ports_follow;
