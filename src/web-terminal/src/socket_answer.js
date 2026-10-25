const caller_allowed = require('./caller_allowed');
const pty_spawn = require('./pty_spawn');
const session_name_from_path = require('./session_name_from_path');
const terminal_attach = require('../../../modules/terminal/server/terminal_attach');
const terminal_refuse = require('../../../modules/terminal/server/terminal_refuse');
const tmux_argv = require('./tmux_argv');
const ws = require('ws');

const sockets = new ws.WebSocketServer({noServer: true});

// The page's websocket, on the page's own path. /<name> attaches to the kept session of that
// name, starting it when there is none; / opens a shell that ends with the socket. Without the
// token there is no handshake at all: a terminal is a shell for whoever reaches it.
function socket_answer(req, socket, head, token)
{
    if (caller_allowed(req, token) === false) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\ncontent-length: 0\r\n\r\n');
        return;
    }
    const pathname = new URL(req.url, 'http://web-terminal.invalid').pathname;
    const name = session_name_from_path(pathname);
    sockets.handleUpgrade(req, socket, head, function (client) {
        if (name === null) {
            terminal_refuse(client, 'no session has that name: lowercase letters, digits, - and _, one word after /');
            return;
        }
        const argv = (name === '') ? [process.env.SHELL || '/bin/bash', '-l'] : tmux_argv(['new-session', '-A', '-s', name]);
        const note = (name === '') ? 'a terminal of its own: it ends when this page closes' : `session ${name}: it stays when this page closes, and /${name} opens it again`;
        const stream = pty_spawn(argv);
        terminal_attach(client, stream, {
            note,
            resize: function (size) {
                stream.resize(size.cols, size.rows);
            },
            end: function () {
                // A tmux client let go and the session goes on; a shell of its own went with it
            },
        });
    });
}

module.exports = socket_answer;
