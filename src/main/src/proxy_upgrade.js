const headers_forwarded = require('./headers_forwarded');
const http = require('http');

// Websockets and other upgrades: two sockets glued together after the handshake. The far one
// is opened the way a request's is, by the instance's agent: a stream inside the link for a
// service on another machine, whose loopback is not this one's
function proxy_upgrade(app, service, instance, req, socket, head)
{
    const upstream = instance.upstream;
    socket_tune(socket);
    if (head && (head.length > 0)) {
        socket.unshift(head);
    }
    const proxy_req = http.request({
        host: upstream.host,
        port: upstream.port,
        method: req.method,
        path: req.url,
        headers: headers_forwarded(req, true),
        agent: instance.agent,
    });
    proxy_req.on('upgrade', function (proxy_res, proxy_socket, proxy_head) {
        socket_tune(proxy_socket);
        if (proxy_head && (proxy_head.length > 0)) {
            proxy_socket.unshift(proxy_head);
        }
        const lines = [`HTTP/1.1 ${proxy_res.statusCode} ${proxy_res.statusMessage}`];
        for (let i = 0; i < proxy_res.rawHeaders.length; i += 2) {
            lines.push(`${proxy_res.rawHeaders[i]}: ${proxy_res.rawHeaders[i + 1]}`);
        }
        socket.write(`${lines.join('\r\n')}\r\n\r\n`);
        proxy_socket.on('error', function () {
            socket.destroy();
        });
        socket.on('error', function () {
            proxy_socket.destroy();
        });
        proxy_socket.pipe(socket);
        socket.pipe(proxy_socket);
    });
    proxy_req.on('response', function () {
        socket.destroy();
    });
    proxy_req.on('error', function () {
        socket.destroy();
    });
    proxy_req.end();
}

function socket_tune(socket)
{
    socket.setTimeout(0);
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 0);
}

module.exports = proxy_upgrade;
