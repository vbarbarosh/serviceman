const fs = require('fs');
const net = require('net');

// Not an agent this time: sshfs runs this in place of ssh, `--pipe <socket>` with ssh's own
// words after it, which mean nothing here. What sshfs writes comes in on stdin and goes to the
// socket; what the socket answers goes out on stdout. The session half listens on that socket
// and carries it over its link (agent_mounts_set). Ends when either end does, and sshfs dials
// again when it wants to.
function agent_pipe(file)
{
    // sshfs hands its own stderr to its ssh, and the root half that started sshfs reads that
    // to its end: kept open here, it would wait for as long as the mount lasts
    fs.closeSync(2);
    fs.openSync('/dev/null', 'w');
    const socket = net.connect({path: String(file), allowHalfOpen: true});
    socket.on('error', function () {
        process.exit(1);
    });
    socket.on('close', function () {
        process.exit(0);
    });
    process.stdin.on('end', function () {
        socket.end();
    });
    process.stdin.pipe(socket, {end: false});
    socket.pipe(process.stdout);
}

module.exports = agent_pipe;
