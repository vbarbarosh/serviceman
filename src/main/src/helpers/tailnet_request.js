const http = require('http');
const https = require('https');
const tls = require('tls');

// One request to an address that may be on the tailnet: {method, headers, body, timeout_ms,
// proxy} -> {status, text}.
//
// Where serviceman runs in its image, tailscale is in userspace mode: it carries what comes in,
// and nothing serviceman dials goes through it — a tailnet address is not routed and a tailnet
// name does not resolve. tailscaled opens a proxy for exactly that, and `proxy` names it: the
// request goes through a tunnel it opens, and tailscale dials and resolves. Without one, the
// request goes straight, as it does on a machine with tailscale of its own.
async function tailnet_request(url, options)
{
    const deadline = Date.now() + options.timeout_ms;
    const port = Number(url.port || ((url.protocol === 'https:') ? 443 : 80));
    const tunnel = ((options.proxy === undefined) || (options.proxy === null) || (options.proxy === '')) ? null : await tunnel_open(new URL(options.proxy), url.hostname, port, deadline, options.timeout_ms);
    return await request_send(url, port, options, tunnel, deadline);
}

// A CONNECT through the proxy: a socket that is a line to the address, once the proxy says so
function tunnel_open(proxy, host, port, deadline, timeout_ms)
{
    return new Promise(function (resolve, reject) {
        const request = http.request({host: proxy.hostname, port: Number(proxy.port || 80), method: 'CONNECT', path: `${host}:${port}`, headers: {host: `${host}:${port}`}, agent: false});
        const timer = setTimeout(function () {
            request.destroy(new Error(`tailscale's proxy at ${proxy.host} did not reach ${host}:${port} within ${timeout_ms/1000}s`));
        }, ms_left(deadline));
        request.once('connect', function (answer, socket) {
            clearTimeout(timer);
            if (answer.statusCode !== 200) {
                socket.destroy();
                reject(new Error(`tailscale's proxy at ${proxy.host} could not reach ${host}:${port} (${answer.statusCode} ${answer.statusMessage})`));
                return;
            }
            resolve(socket);
        });
        request.once('error', function (error) {
            clearTimeout(timer);
            reject(error.message.startsWith('tailscale') ? error : new Error(`tailscale's proxy at ${proxy.host}: ${error.message}`));
        });
        request.end();
    });
}

function request_send(url, port, options, tunnel, deadline)
{
    return new Promise(function (resolve, reject) {
        const secure = (url.protocol === 'https:');
        const request_options = {
            method: options.method,
            host: url.hostname,
            port,
            path: `${url.pathname}${url.search}`,
            headers: options.headers,
        };
        // No agent at all when there is a tunnel: node takes the connection from an agent when
        // there is one — even `agent: false` makes a fresh one — and dials on its own, around
        // the tunnel. Without an agent it uses the connection it is handed.
        if (tunnel === null) {
            request_options.agent = false;
        }
        else {
            request_options.createConnection = function () {
                return secure ? tls.connect({socket: tunnel, servername: url.hostname}) : tunnel;
            };
        }
        const request = (secure ? https : http).request(request_options, function (answer) {
            const chunks = [];
            answer.on('data', function (chunk) {
                chunks.push(chunk);
            });
            answer.on('end', function () {
                clearTimeout(timer);
                resolve({status: answer.statusCode, status_text: answer.statusMessage, text: Buffer.concat(chunks).toString('utf8')});
            });
            answer.on('error', reject);
        });
        const timer = setTimeout(function () {
            request.destroy(new Error(`no answer within ${options.timeout_ms/1000}s`));
        }, ms_left(deadline));
        request.once('error', function (error) {
            clearTimeout(timer);
            reject(error);
        });
        request.end(options.body);
    });
}

// What is left of the time given, never less than nothing
function ms_left(deadline)
{
    return Math.max(0, deadline - Date.now());
}

module.exports = tailnet_request;
