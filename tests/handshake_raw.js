const net = require('net');

const KEY = 'dGhlIHNhbXBsZSBub25jZQ==';
const WAIT_MS = 2000;

// A websocket handshake written by hand, for what no client library would send: a request
// target that is no address, a frame the protocol forbids once the door is open. Answers the
// first line the door said, `closed` when it hung up without a word, `left open` when it did
// neither in two seconds: a door that neither answers nor hangs up is a handler that broke.
//
//     options = {port, host, target, headers, frame}
//     headers  more header lines, as an object
//     frame    bytes sent the moment the door answers 101
function handshake_raw(options)
{
    return new Promise(function (resolve) {
        const headers = Object.assign({'Host': options.host, 'Connection': 'Upgrade', 'Upgrade': 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': KEY}, options.headers);
        const socket = net.connect(options.port, '127.0.0.1', function () {
            socket.write(`GET ${options.target} HTTP/1.1\r\n${Object.keys(headers).map(v => `${v}: ${headers[v]}\r\n`).join('')}\r\n`);
        });
        let said = 'closed';
        let sent = false;
        const timer = setTimeout(function () {
            said = (said === 'closed') ? 'left open' : said;
            socket.destroy();
        }, WAIT_MS);
        socket.on('data', function (chunk) {
            if (said === 'closed') {
                said = String(chunk).split('\r\n')[0];
            }
            if ((options.frame !== undefined) && (sent === false) && said.includes(' 101 ')) {
                sent = true;
                socket.write(options.frame);
            }
        });
        socket.on('error', function () {
            socket.destroy();
        });
        socket.on('close', function () {
            clearTimeout(timer);
            resolve(said);
        });
    });
}

module.exports = handshake_raw;
