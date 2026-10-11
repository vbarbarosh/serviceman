const http = require('http');

// A request to serviceman with the Host header the test wants to be seen as
function fetch_host(options)
{
    return new Promise(function (resolve, reject) {
        const req = http.request({
            host: '127.0.0.1',
            port: options.port,
            agent: false,
            method: options.method || 'GET',
            path: options.path || '/',
            headers: Object.assign({host: options.host || '127.0.0.1'}, options.headers || {}),
        }, function (res) {
            const chunks = [];
            res.on('data', function (chunk) {
                chunks.push(chunk);
            });
            res.on('end', function () {
                resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8')});
            });
        });
        req.on('error', reject);
        req.end(options.body);
    });
}

module.exports = fetch_host;
