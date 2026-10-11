const agent_dir = require('./agent_dir');
const net = require('net');
const path = require('path');

// `bin/status` asks the agent, and the agent answers. Nothing here reads a file: an agent that
// cannot be asked is an agent that is not running, and that is the answer.
function agent_status_ask()
{
    const file = path.join(agent_dir(), 'status.sock');
    return new Promise(function (resolve) {
        const socket = net.connect(file);
        const chunks = [];
        socket.on('data', function (chunk) {
            chunks.push(chunk);
        });
        socket.on('end', function () {
            process.stdout.write(Buffer.concat(chunks).toString('utf8'));
            resolve(0);
        });
        socket.on('error', function (error) {
            console.error(`serviceman-agent: no agent is answering at ${file} — ${error.message}`);
            resolve(1);
        });
    });
}

module.exports = agent_status_ask;
