#!/usr/bin/env node

const cli = require('@vbarbarosh/node-helpers/src/cli');
const http = require('http');
const net = require('net');

cli(main);

function main()
{
    const port = parseInt(process.argv[2], 10);
    const name = process.argv[3];
    const boot_ms = parseInt(process.env.SERVICEMAN_TEST_BOOT_MS || '0', 10);
    const server = http.createServer(function (req, res) {
        const slow = /^\/slow\/(\d+)/.exec(req.url);
        const delay = ((slow === null) ? 0 : parseInt(slow[1], 10));
        setTimeout(function () {
            if (req.url === '/cut') {
                res.writeHead(200, {'content-type': 'text/plain; charset=utf-8', 'content-length': 1000000, 'x-service': name});
                res.write('the answer breaks off he');
                setTimeout(function () {
                    req.socket.resetAndDestroy();
                }, 50);
                return;
            }
            res.writeHead(200, {'content-type': 'text/plain; charset=utf-8', 'x-service': name});
            res.end(`hello from ${name} at ${req.headers.host}${req.url}\n`);
        }, delay);
    });
    server.on('upgrade', function (req, socket) {
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: echo\r\nconnection: Upgrade\r\nx-service: ${name}\r\n\r\n`);
        socket.pipe(socket);
    });
    if (process.env.SERVICEMAN_TEST_SLAM === '1') {
        server.on('connection', function (socket) {
            socket.resetAndDestroy();
        });
    }
    // What docker really does: the published port accepts from the first moment, and whatever
    // is behind it drops the connection until the app inside has bound it
    const deaf_ms = parseInt(process.env.SERVICEMAN_TEST_DEAF_MS || '0', 10);
    if (deaf_ms > 0) {
        const door = net.createServer(function (socket) {
            socket.resetAndDestroy();
        });
        door.listen(port, '127.0.0.1');
        setTimeout(function () {
            door.close();
            server.listen(port, '127.0.0.1');
        }, deaf_ms);
        return;
    }
    setTimeout(function () {
        server.listen(port, '127.0.0.1');
    }, boot_ms);
}
