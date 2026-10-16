const EventEmitter = require('events');
const ws = require('ws');

// Joins the terminal `name` on the machine `remote`, the same one the Shell tab shows: made
// when it is not running, left running when the socket closes. What the terminal prints comes
// as `data` (a Buffer, escapes and all, for xterm or a real tty to draw); `note` is the line
// serviceman says first; `close` is the terminal gone or the socket closed. `token` is the
// owner's, sent as Authorization: Bearer: without it serviceman closes the socket at once, and
// `error` says "socket hang up".
//
//     options = {url, token, remote, name, cols, rows}
//     out.write(text)          types into the terminal
//     out.resize(cols, rows)   the terminal takes this size
//     out.close()              leaves the terminal, which keeps running
function terminal_connect(options)
{
    const url = new URL(`/api/v1/shell?remote=${encodeURIComponent(options.remote)}&term=${encodeURIComponent(options.name)}`, options.url);
    url.protocol = ((url.protocol === 'https:') ? 'wss:' : 'ws:');
    const headers = {};
    if ((typeof options.token === 'string') && (options.token !== '')) {
        headers.authorization = `Bearer ${options.token}`;
    }
    const socket = new ws.WebSocket(url, {headers});
    const out = new EventEmitter();
    out.write = function (text) {
        send({type: 'input', data: text});
    };
    out.resize = function (cols, rows) {
        send({type: 'resize', cols, rows});
    };
    out.close = function () {
        socket.close();
    };
    socket.on('open', function () {
        out.resize(options.cols || 80, options.rows || 24);
        out.emit('open');
    });
    // The terminal's bytes come binary; serviceman's own words come as json text
    socket.on('message', function (data, binary) {
        if (binary) {
            out.emit('data', data);
            return;
        }
        const message = JSON.parse(String(data));
        if (message.type === 'note') {
            out.emit('note', message.text);
        }
    });
    socket.on('close', function () {
        out.emit('close');
    });
    socket.on('error', function (error) {
        out.emit('error', error);
    });
    return out;

    function send(message) {
        if (socket.readyState === ws.WebSocket.OPEN) {
            socket.send(JSON.stringify(message));
        }
    }
}

module.exports = terminal_connect;
