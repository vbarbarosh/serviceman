const http = require('http');

// The owner's token of every serviceman the tests start in this process: the servicemans read
// it from the environment, as one in docker started with -e may
const OWNER_TOKEN = 'sm_the-owner-of-the-tests';
process.env.SERVICEMAN_OWNER_TOKEN = OWNER_TOKEN;

// A request to serviceman with the Host header the test wants to be seen as. It brings the
// owner's token, as the signed-in page does; token: null sends none, token: '…' that one.
function fetch_host(options)
{
    return new Promise(function (resolve, reject) {
        const request = http.request({
            host: '127.0.0.1',
            port: options.port,
            agent: false,
            method: options.method || 'GET',
            path: options.path || '/',
            headers: Object.assign({host: options.host || '127.0.0.1'}, token_header(options), options.headers || {}),
        }, function (answer) {
            const chunks = [];
            answer.on('data', function (chunk) {
                chunks.push(chunk);
            });
            answer.on('end', function () {
                resolve({status: answer.statusCode, headers: answer.headers, body: Buffer.concat(chunks).toString('utf8')});
            });
        });
        request.on('error', reject);
        request.end(options.body);
    });
}

function token_header(options)
{
    if (options.token === null) {
        return {};
    }
    return {authorization: `Bearer ${(options.token === undefined) ? OWNER_TOKEN : options.token}`};
}

fetch_host.OWNER_TOKEN = OWNER_TOKEN;

module.exports = fetch_host;
