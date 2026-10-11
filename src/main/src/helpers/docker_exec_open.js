const http = require('http');

// bash when the image has it, sh when it does not — most images have only one of the two
const SHELL_CMD = ['/bin/sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'];

// A shell inside a running container: the REMOTE_API_KEEP over its socket, hijacked into a raw
// stream. The socket is reached by whatever `connect` opens — a socket on this machine, or a
// stream through the link to the socket on a remote's machine.
async function docker_exec_open(connect, container_name, size)
{
    const created = await api_json(connect, 'POST', `/containers/${encodeURIComponent(container_name)}/exec`, {
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Cmd: SHELL_CMD,
        Env: ['TERM=xterm-256color'],
        ConsoleSize: [size.rows, size.cols],
    });
    const stream = await api_hijack(connect, `/exec/${created.Id}/start`, {Detach: false, Tty: true});
    return {id: created.Id, stream};
}

function api_json(connect, method, path, value)
{
    return new Promise(function (resolve, reject) {
        const body = JSON.stringify(value);
        const req = http.request({createConnection: connect, method, path, headers: headers_json(body)}, function (res) {
            const chunks = [];
            res.on('data', function (chunk) {
                chunks.push(chunk);
            });
            res.on('end', function () {
                const text = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode >= 400) {
                    reject(new Error(message_from_answer(text, res.statusCode)));
                    return;
                }
                resolve((text === '') ? {} : JSON.parse(text));
            });
        });
        req.on('error', reject);
        req.end(body);
    });
}

// docker answers the start of an exec with 101 and then speaks the shell over the same socket
function api_hijack(connect, path, value)
{
    return new Promise(function (resolve, reject) {
        const body = JSON.stringify(value);
        const headers = Object.assign(headers_json(body), {connection: 'Upgrade', upgrade: 'tcp'});
        const req = http.request({createConnection: connect, method: 'POST', path, headers});
        req.on('upgrade', function (res, socket, head) {
            // What the shell wrote before we listened arrived with the handshake
            if (head && (head.length > 0)) {
                socket.unshift(head);
            }
            resolve(socket);
        });
        req.on('response', function (res) {
            const chunks = [];
            res.on('data', function (chunk) {
                chunks.push(chunk);
            });
            res.on('end', function () {
                reject(new Error(message_from_answer(Buffer.concat(chunks).toString('utf8'), res.statusCode)));
            });
        });
        req.on('error', reject);
        req.end(body);
    });
}

function headers_json(body)
{
    return {'content-type': 'application/json', 'content-length': Buffer.byteLength(body)};
}

function message_from_answer(text, status)
{
    try {
        return JSON.parse(text).message || `docker answered ${status}`;
    }
    catch {
        return text || `docker answered ${status}`;
    }
}

module.exports = docker_exec_open;
