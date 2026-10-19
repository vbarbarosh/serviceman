const assert = require('assert');
const http = require('http');
const net = require('net');
const tailnet_request = require('../src/main/src/helpers/tailnet_request');
const test = require('node:test');

test('a request goes straight, or through tailscale\'s proxy when one is named', async function (t) {
    const target = await listen(t, http.createServer(function (req, res) {
        let text = '';
        req.on('data', function (chunk) {
            text += chunk;
        });
        req.on('end', function () {
            res.writeHead(201, {'content-type': 'application/json'});
            res.end(JSON.stringify({method: req.method, path: req.url, auth: req.headers.authorization, body: text}));
        });
    }));
    const tunnels = [];
    const proxy = await listen(t, proxy_make(tunnels, true));
    const options = {method: 'POST', headers: {'authorization': 'Bearer abc', 'content-length': 2}, body: '{}', timeout_ms: 2000};

    const straight = await tailnet_request(new URL(`http://127.0.0.1:${target}/tokens?x=1`), options);
    assert.strictEqual(straight.status, 201);
    assert.deepStrictEqual(JSON.parse(straight.text), {method: 'POST', path: '/tokens?x=1', auth: 'Bearer abc', body: '{}'});
    assert.deepStrictEqual(tunnels, []);

    // A name only the proxy knows, the way only tailscale knows server.tail1234.ts.net: a
    // request that went around the tunnel would not find it at all
    const tailnet_url = new URL(`http://logline.tailnet.invalid:${target}/tokens?x=1`);
    await assert.rejects(tailnet_request(tailnet_url, options), /ENOTFOUND logline\.tailnet\.invalid/);
    const through = await tailnet_request(tailnet_url, Object.assign({}, options, {proxy: `http://localhost:${proxy}`}));
    assert.strictEqual(through.status, 201);
    assert.deepStrictEqual(JSON.parse(through.text), {method: 'POST', path: '/tokens?x=1', auth: 'Bearer abc', body: '{}'});
    assert.deepStrictEqual(tunnels, [`logline.tailnet.invalid:${target}`], 'the request went over the line the proxy opened');
});

test('a proxy that cannot reach the address says so, and silence is a timeout', async function (t) {
    const refusing = await listen(t, proxy_make([], false));
    const url = new URL('http://100.64.0.22:3000/tokens');
    await assert.rejects(tailnet_request(url, {method: 'POST', headers: {}, timeout_ms: 2000, proxy: `http://localhost:${refusing}`}), /^Error: tailscale's proxy at localhost:\d+ could not reach 100\.64\.0\.22:3000 \(502 Bad Gateway\)$/);
    const silent = await listen(t, net.createServer(function () {
        // Takes the connection, and never says a word
    }));
    await assert.rejects(tailnet_request(new URL(`http://127.0.0.1:${silent}/tokens`), {method: 'POST', headers: {}, timeout_ms: 300}), /^Error: no answer within 0\.3s$/);
    await assert.rejects(tailnet_request(url, {method: 'POST', headers: {}, timeout_ms: 300, proxy: `http://localhost:${silent}`}), /^Error: tailscale's proxy at localhost:\d+ did not reach 100\.64\.0\.22:3000 within 0\.3s$/);
});

// A stand-in for tailscaled's --outbound-http-proxy-listen: CONNECT, and a line to the address
function proxy_make(tunnels, reaching)
{
    const out = http.createServer();
    out.on('connect', function (req, socket) {
        if (reaching === false) {
            socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            return;
        }
        tunnels.push(req.url);
        const [host, port] = req.url.split(':');
        // What tailscale does for a tailnet name: it knows where it is
        const line = net.connect(Number(port), (host === 'logline.tailnet.invalid') ? '127.0.0.1' : host, function () {
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            line.pipe(socket);
            socket.pipe(line);
        });
        line.on('error', () => socket.destroy());
        socket.on('error', () => line.destroy());
    });
    return out;
}

async function listen(t, server)
{
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(function () {
        if (server.closeAllConnections !== undefined) {
            server.closeAllConnections();
        }
        server.close();
    });
    return server.address().port;
}
