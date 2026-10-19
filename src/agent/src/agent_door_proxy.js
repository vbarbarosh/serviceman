const agent_http_error = require('./agent_http_error');
const http = require('http');

// Headers that are about one connection and not the request: never carried to the next one
const HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade'];
// A far end that takes no connection in this time is away (a machine asleep, off the tailnet):
// the visitor hears 502 now, not when the system gives up on it two minutes later
const CONNECT_MS = 10000;

// The request carried on to where it is answered, and the answer back as it came, Set-Cookie
// lines and all. `target` is {host, port} or {socket}; `extra` is headers set on the way.
// Answers false when the far end could not be reached, so the caller can forget the address.
function agent_door_proxy(req, res, target, extra)
{
    return new Promise(function (resolve) {
        const headers = headers_of(req.headers, extra);
        const where = (target.socket === undefined) ? {host: target.host, port: target.port} : {socketPath: target.socket};
        const request = http.request(Object.assign(where, {method: req.method, path: req.url, headers, agent: false}), function (answer) {
            const raw = [];
            for (let i = 0; i < answer.rawHeaders.length; i += 2) {
                if (HOP.includes(answer.rawHeaders[i].toLowerCase()) === false) {
                    raw.push(answer.rawHeaders[i], answer.rawHeaders[i + 1]);
                }
            }
            res.writeHead(answer.statusCode, answer.statusMessage, raw);
            answer.pipe(res);
            answer.on('end', function () {
                resolve(true);
            });
        });
        const timer = setTimeout(function () {
            request.destroy(new Error('no connection in time'));
        }, agent_door_proxy.connect_ms);
        request.on('socket', function (socket) {
            socket.once('connect', function () {
                clearTimeout(timer);
            });
        });
        request.on('error', function () {
            clearTimeout(timer);
            if (res.headersSent) {
                res.destroy();
            }
            else {
                agent_http_error(res, 502);
            }
            resolve(false);
        });
        req.pipe(request);
    });
}

function headers_of(given, extra)
{
    const kept = {};
    for (const name of Object.keys(given)) {
        if (HOP.includes(name) === false) {
            kept[name] = given[name];
        }
    }
    return Object.assign(kept, extra);
}

agent_door_proxy.headers_of = headers_of;
// Shorter in a test, which waits on a far end that never connects
agent_door_proxy.connect_ms = CONNECT_MS;

module.exports = agent_door_proxy;
