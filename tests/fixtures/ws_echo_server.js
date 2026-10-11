const cli = require('@vbarbarosh/node-helpers/src/cli');
const http = require('http');
const ws = require('ws');

// An app with a websocket, as a web terminal is: every message comes back with `echo ` before it
const port = Number(process.argv[2]);

cli(main);

function main()
{
    const server = http.createServer(function (req, res) {
        res.end('the page');
    });
    const sockets = new ws.WebSocketServer({server});
    sockets.on('connection', function (client) {
        client.on('message', function (data) {
            client.send(`echo ${data}`);
        });
    });
    server.listen(port, '127.0.0.1');
}
