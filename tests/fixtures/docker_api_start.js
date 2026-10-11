const fs = require('fs');
const http = require('http');

// The part of the Engine API a shell needs: create an exec, hijack it, resize it — and the list
// of containers, and starting, stopping and restarting one, for the Docker tab
function docker_api_start(socket_path)
{
    const state = {execs: {}, resizes: [], containers: [], asked: []};
    const server = http.createServer(function (req, res) {
        if ((req.method === 'GET') && (req.url === '/containers/json?all=1')) {
            send_json(res, 200, state.containers);
            return;
        }
        const action = /^\/containers\/([0-9a-f]+)\/(start|stop|restart)$/.exec(req.url);
        if ((req.method === 'POST') && (action !== null)) {
            state.asked.push(`${action[2]} ${action[1]}`);
            res.writeHead(204);
            res.end();
            return;
        }
        const match = /^\/containers\/([^/]+)\/exec$/.exec(req.url);
        if (match !== null) {
            read_body(req, function (body) {
                const id = `exec${Object.keys(state.execs).length + 1}`;
                state.execs[id] = {container: decodeURIComponent(match[1]), created: JSON.parse(body)};
                send_json(res, 201, {Id: id});
            });
            return;
        }
        if (/^\/exec\/[^/]+\/resize/.test(req.url)) {
            state.resizes.push(req.url);
            send_json(res, 200, {});
            return;
        }
        send_json(res, 404, {message: `no such path ${req.url}`});
    });
    server.on('upgrade', function (req, socket) {
        const match = /^\/exec\/([^/]+)\/start$/.exec(req.url);
        if ((match === null) || (state.execs[match[1]] === undefined)) {
            socket.destroy();
            return;
        }
        socket.write('HTTP/1.1 101 UPGRADED\r\ncontent-type: application/vnd.docker.raw-stream\r\nconnection: Upgrade\r\nupgrade: tcp\r\n\r\n');
        socket.write(`# ${state.execs[match[1]].container} $ `);
        socket.on('error', function () {});
        socket.on('data', function (chunk) {
            socket.write(chunk);
        });
    });
    return new Promise(function (resolve) {
        fs.rmSync(socket_path, {force: true});
        server.listen(socket_path, function () {
            resolve({server, state, close: () => server.close()});
        });
    });
}

function read_body(req, next)
{
    const chunks = [];
    req.on('data', function (chunk) {
        chunks.push(chunk);
    });
    req.on('end', function () {
        next(Buffer.concat(chunks).toString('utf8'));
    });
}

function send_json(res, status, value)
{
    const text = JSON.stringify(value);
    res.writeHead(status, {'content-type': 'application/json', 'content-length': Buffer.byteLength(text)});
    res.end(text);
}

module.exports = docker_api_start;
