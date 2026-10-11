const http = require('http');

// One GET to the docker engine over its socket: the answer as it streams. Reading logs and
// events this way, rather than through the docker command, keeps a container's two streams in
// the one order docker wrote them.
function docker_api(socket, pathname)
{
    return new Promise(function (resolve, reject) {
        const req = http.request({socketPath: socket, path: pathname, method: 'GET', headers: {host: 'docker'}}, resolve);
        req.once('error', reject);
        req.end();
    });
}

// The same, for an answer that is JSON: parsed, or thrown with what docker said
docker_api.json = async function (socket, pathname) {
    const res = await docker_api(socket, pathname);
    const chunks = [];
    for await (const chunk of res) {
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if ((res.statusCode < 200) || (res.statusCode > 299)) {
        const error = new Error(`docker ${res.statusCode}: ${text.trim()}`);
        error.status = res.statusCode;
        throw error;
    }
    return JSON.parse(text);
};

module.exports = docker_api;
