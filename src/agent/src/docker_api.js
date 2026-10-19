const http = require('http');

// One GET to the docker engine over its socket: the answer as it streams. Reading logs and
// events this way, rather than through the docker command, keeps a container's two streams in
// the one order docker wrote them.
function docker_api(socket, pathname)
{
    return new Promise(function (resolve, reject) {
        const request = http.request({socketPath: socket, path: pathname, method: 'GET', headers: {host: 'docker'}}, resolve);
        request.once('error', reject);
        request.end();
    });
}

// The same, for an answer that is JSON: parsed, or thrown with what docker said
docker_api.json = async function (socket, pathname) {
    const answer = await docker_api(socket, pathname);
    const chunks = [];
    for await (const chunk of answer) {
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if ((answer.statusCode < 200) || (answer.statusCode > 299)) {
        const failure = new Error(`docker ${answer.statusCode}: ${text.trim()}`);
        failure.status = answer.statusCode;
        throw failure;
    }
    return JSON.parse(text);
};

module.exports = docker_api;
