const http = require('http');
const https = require('https');

const KEEPALIVE_MS = 30000;
const LINK_PATH = '/api/v1/remote';

// One knock on the serviceman door. It answers 101 and the socket becomes the link, or it
// answers with the reason it will not.
//
// The token is the whole introduction: serviceman looks up the remote that holds it and says
// which one it was in the answer, so this end knows the name it was given without being told.
//
// The door is a host and a port, or a socket file — `unix:///run/serviceman.sock`. A socket file
// is what an ssh forward hands you, so an agent can reach a serviceman that listens on nothing.
function agent_connect(options)
{
    return new Promise(function (resolve, reject) {
        const url = new URL(options.url);
        const carrier = (url.protocol === 'https:') ? https : http;
        const request = carrier.request(Object.assign(where(url), {
            path: `${(url.protocol === 'unix:') ? '' : url.pathname.replace(/\/+$/, '')}${LINK_PATH}`,
            headers: {
                host: (url.protocol === 'unix:') ? 'localhost' : url.host,
                connection: 'Upgrade',
                upgrade: 'serviceman',
                authorization: `Bearer ${options.token}`,
                // Only a machine adding itself with the join token is asked who it is and what
                // it can do; a machine that holds its own token is already written down
                'serviceman-machine': options.machine,
                'serviceman-tags': options.tags.join(','),
            },
        }));
        request.on('upgrade', function (answer, socket, head) {
            if (head.length > 0) {
                socket.unshift(head);
            }
            socket.setNoDelay(true);
            if (url.protocol !== 'unix:') {
                // A socket file has no connection to keep alive; the file is either there or gone
                socket.setKeepAlive(true, KEEPALIVE_MS);
            }
            resolve({socket, name: answer.headers['serviceman-remote'] || '?'});
        });
        request.on('response', function (answer) {
            const chunks = [];
            answer.on('data', function (chunk) {
                chunks.push(chunk);
            });
            answer.on('end', function () {
                const refusal = new Error(`${options.url} refused the link: ${answer.statusCode} ${Buffer.concat(chunks).toString('utf8').trim()}`);
                // A refusal the agent is meant to act on rather than wait out. Only this one
                // word does anything: every other refusal is dialled again, because a host
                // that is confused today may be right tomorrow.
                refusal.refused = String(answer.headers['serviceman-refused'] || '');
                reject(refusal);
            });
        });
        request.on('error', reject);
        request.end();
    });
}

// Where to knock: a socket file, or a host and a port
function where(url)
{
    if (url.protocol === 'unix:') {
        return {socketPath: decodeURIComponent(url.pathname)};
    }
    return {protocol: url.protocol, hostname: url.hostname, port: url.port};
}

module.exports = agent_connect;
