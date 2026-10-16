const http = require('http');

const TIMEOUT_MS = 15000;

// One call to a Docker Engine API reached through `connect` (docker_exec_connect), answered
// with its JSON: a list of containers, one container inspected, a start. An answer of 400 or
// more is an error carrying Docker's own message.
function engine_json(connect, method, path)
{
    return new Promise(function (resolve, reject) {
        const req = http.request({createConnection: connect, method, path, timeout: TIMEOUT_MS}, function (res) {
            const chunks = [];
            res.on('data', function (chunk) {
                chunks.push(chunk);
            });
            res.on('end', function () {
                const text = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode >= 400) {
                    reject(new Error(`docker answered ${res.statusCode}: ${message_of(text)}`));
                    return;
                }
                try {
                    resolve((text.trim() === '') ? {} : JSON.parse(text));
                }
                catch (error) {
                    reject(error);
                }
            });
            res.on('error', reject);
        });
        req.on('timeout', function () {
            req.destroy(new Error(`docker did not answer in ${TIMEOUT_MS/1000}s`));
        });
        req.on('error', reject);
        req.end();
    });
}

function message_of(text)
{
    try {
        return JSON.parse(text).message;
    }
    catch {
        return text.trim();
    }
}

module.exports = engine_json;
