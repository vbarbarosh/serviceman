const http = require('http');

// Where a box has serviceman's control socket, mounted
const SOCKET_DEFAULT = '/sockets/serviceman.sock';

// One call to serviceman's control door, through its socket, with the token this box was
// given. What serviceman answered comes back whatever its status, its JSON parsed; a socket
// that is not there or that nobody answers on is thrown, with its path and the variable that
// names another. The token is sent and never said.
//
//     method    PUT, GET
//     pathname  /api/v1/apps/notes
//     body      a Buffer; an empty one for a GET
//
//     {status, json, text}   json null when the answer is no JSON
function control_request(method, pathname, body)
{
    const socket = String(process.env.SERVICEMAN_SOCKET || '').trim() || SOCKET_DEFAULT;
    const token = String(process.env.SERVICEMAN_TOKEN || '').trim();
    if (token === '') {
        return Promise.reject(new Error('SERVICEMAN_TOKEN is not set: serviceman\'s control door wants a token, and this box was given none'));
    }
    return new Promise(function (resolve, reject) {
        const headers = {host: 'localhost', authorization: `Bearer ${token}`, 'content-length': body.length};
        const request = http.request({socketPath: socket, method, path: pathname, headers}, function (answer) {
            const chunks = [];
            answer.on('data', function (chunk) {
                chunks.push(chunk);
            });
            answer.on('error', reject);
            answer.on('end', function () {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve({status: answer.statusCode, json: json_or_null(text), text});
            });
        });
        request.on('error', function (error) {
            reject(new Error(`serviceman's control socket ${socket} did not answer (${error.message}); SERVICEMAN_SOCKET names another`));
        });
        request.end(body);
    });
}

// What serviceman said when it did not do what was asked, as the error a tool fails with: its
// own sentence, for the agent to act on, or the start of what it answered when it said none
control_request.refusal_of = function (answer) {
    const said = ((answer.json !== null) && (typeof answer.json.error === 'string')) ? answer.json.error : answer.text.trim().slice(0, 300);
    return new Error(`serviceman answered ${answer.status}: ${said}`);
};

function json_or_null(text)
{
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}

module.exports = control_request;
