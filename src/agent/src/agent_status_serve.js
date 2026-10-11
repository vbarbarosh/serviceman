const agent_dir = require('./agent_dir');
const agent_root_there = require('./agent_root_there');
const agent_status = require('./agent_status');
const fs = require('fs');
const net = require('net');
const path = require('path');

const SOCKET_MODE = 0o600;

// The agent answers for itself: a socket beside it, and whoever opens it gets what is going on
// at that moment. Nothing is kept on disk to go stale — a status file is a promise about the
// past, and the one question worth asking of an agent is what it is doing now.
function agent_status_serve(status, options)
{
    const file = path.join(agent_dir(), 'status.sock');
    const out = net.createServer(function (socket) {
        socket.on('error', function () {
            socket.destroy();
        });
        // The root half is asked for here rather than remembered: one installed a minute ago
        // is one this answer should already know about
        const promise = agent_root_there(options);
        promise.then(function (there) {
            status.root = there;
            socket.end(agent_status(status));
        });
    });
    out.on('error', function (error) {
        console.error(`serviceman-agent: the status socket cannot be opened — ${error.message}`);
    });
    // A socket file outlives the process that made it; one nobody answers on is this one's to take
    try {
        fs.unlinkSync(file);
    }
    catch {
        // It was not there, which is the usual case
    }
    out.listen(file, function () {
        fs.chmodSync(file, SOCKET_MODE);
    });
    out.unref();
    return out;
}

module.exports = agent_status_serve;
