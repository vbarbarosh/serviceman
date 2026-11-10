const http = require('http');
const request_answer = require('./request_answer');
const socket_answer = require('./socket_answer');

// The server, not yet listening: its requests and its websockets, each held to the token.
// What answering one throws costs that caller alone, a 400 or a closed socket: thrown out of
// here it would end the process, and every open terminal with it. An address that is no
// address (`//` reads as a host with no name) throws before the token is looked at.
function server_make(token)
{
    const out = http.createServer(function (req, res) {
        request_answer(req, res, token).catch(function () {
            refuse(res);
        });
    });
    out.on('upgrade', function (req, socket, head) {
        try {
            socket_answer(req, socket, head, token);
        }
        catch {
            socket.destroy();
        }
    });
    return out;
}

// 400 for a request whose answer was not begun; one already on its way is cut where it is
function refuse(res)
{
    if (res.headersSent) {
        res.destroy();
        return;
    }
    res.writeHead(400, {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'});
    res.end('bad request\n');
}

module.exports = server_make;
