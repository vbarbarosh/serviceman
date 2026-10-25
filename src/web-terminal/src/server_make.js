const http = require('http');
const request_answer = require('./request_answer');
const socket_answer = require('./socket_answer');

// The server, not yet listening: its requests and its websockets, each held to the token
function server_make(token)
{
    const out = http.createServer(function (req, res) {
        request_answer(req, res, token);
    });
    out.on('upgrade', function (req, socket, head) {
        socket_answer(req, socket, head, token);
    });
    return out;
}

module.exports = server_make;
