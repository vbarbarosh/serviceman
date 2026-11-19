const http = require('http');

// One request to a machine's Docker Engine API, answered whole: {status, body}, the body as
// text. `connect` opens a stream to the engine (docker_exec_connect); a value goes as JSON,
// a Buffer as it is, with its type.
function engine_call(connect, method, pathname, value, type)
{
    return new Promise(function (resolve, reject) {
        let body = null;
        let headers = {host: 'docker'};
        if (Buffer.isBuffer(value)) {
            body = value;
            headers = {'host': 'docker', 'content-type': type, 'content-length': body.length};
        }
        else if (value !== undefined) {
            body = Buffer.from(JSON.stringify(value));
            headers = {'host': 'docker', 'content-type': 'application/json', 'content-length': body.length};
        }
        const request = http.request({createConnection: connect, method, path: pathname, headers}, function (answer) {
            const chunks = [];
            answer.on('data', function (chunk) {
                chunks.push(chunk);
            });
            answer.on('end', function () {
                resolve({status: answer.statusCode, body: Buffer.concat(chunks).toString('utf8')});
            });
            answer.on('error', reject);
        });
        request.on('error', reject);
        request.end((body === null) ? undefined : body);
    });
}

module.exports = engine_call;
