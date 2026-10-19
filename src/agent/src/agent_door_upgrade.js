const agent_door_proxy = require('./agent_door_proxy');
const net = require('net');

// A connection that asks to become something else — a websocket — carried on as bytes both
// ways once the far end is reached. `extra` is headers set on the way.
function agent_door_upgrade(req, socket, head, target, extra)
{
    const where = (target.socket === undefined) ? {host: target.host, port: target.port} : {path: target.socket};
    const far = net.connect(where);
    // Away is told as quickly as for a request: the same time to connect
    far.setTimeout(agent_door_proxy.connect_ms, function () {
        far.destroy(new Error('no connection in time'));
    });
    far.once('connect', function () {
        far.setTimeout(0);
        const lines = [`${req.method} ${req.url} HTTP/1.1`];
        const headers = Object.assign({}, req.headers, extra);
        for (const name of Object.keys(headers)) {
            lines.push(`${name}: ${headers[name]}`);
        }
        far.write(`${lines.join('\r\n')}\r\n\r\n`);
        if (head.length > 0) {
            far.write(head);
        }
        far.pipe(socket);
        socket.pipe(far);
    });
    far.on('error', function () {
        socket.destroy();
    });
    socket.on('error', function () {
        far.destroy();
    });
}

module.exports = agent_door_upgrade;
