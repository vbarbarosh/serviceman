const agent_dir = require('./agent_dir');
const child_process = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

// How long a new keeper has to answer on its socket
const KEEPER_WAIT_MS = 3000;
const KEEPER_POLL_MS = 50;

// The socket of the keeper of this machine's screens (agent_term_keeper), started when none
// answers on it: detached, as the holders are, so a restart of the agent leaves it running.
// Null when it does not come up: a holder goes on without one, and its joins are handed the
// history as printed. It is started from the agent's own file: the one file it runs as, or its
// entry in the repo, whichever program asked (a test too).
async function agent_term_keeper_start()
{
    const socket_path = agent_term_keeper_start.socket_path();
    if (await answers(socket_path)) {
        return socket_path;
    }
    fs.mkdirSync(path.dirname(socket_path), {recursive: true, mode: 0o700});
    const child = child_process.spawn(process.execPath, [agent_file(), '--term-keeper', socket_path], {detached: true, stdio: 'ignore'});
    // A spawn that fails says so as an event, and unheard it would take the agent down with it
    child.on('error', function () {});
    child.unref();
    const time0 = Date.now();
    while (Date.now() - time0 < KEEPER_WAIT_MS) {
        if (await answers(socket_path)) {
            return socket_path;
        }
        await new Promise(v => setTimeout(v, KEEPER_POLL_MS));
    }
    return null;
}

// In the agent's folder, beside the folder of the terminals, which holds theirs alone
agent_term_keeper_start.socket_path = function () {
    return path.join(agent_dir(), 'term-keeper.sock');
};

// In the agent's one file every module is that file; in the repo this module sits under the
// agent's entry
function agent_file()
{
    return (path.basename(__filename) === 'agent_term_keeper_start.js') ? path.join(__dirname, '..', 'index.js') : __filename;
}

function answers(socket_path)
{
    return new Promise(function (resolve) {
        const socket = net.connect({path: socket_path});
        socket.once('connect', function () {
            socket.destroy();
            resolve(true);
        });
        socket.once('error', () => resolve(false));
    });
}

module.exports = agent_term_keeper_start;
