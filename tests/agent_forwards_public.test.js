const agent_forwards_set = require('../src/agent/src/agent_forwards_set');
const assert = require('assert');
const net = require('net');
const test = require('node:test');
const tls = require('tls');
const tls_cert_make = require('../src/main/src/helpers/tls_cert_make');

// A database server's public port as its agent opens it: on every address, `host` 0.0.0.0,
// speaking TLS with the certificate it is told, joined to the server's port on this machine
// (`dial`), and letting in the addresses on its list alone, before any handshake. Told again
// with something else (TLS off, another list), it listens anew; taken out of the list, it closes.
test('a public port listens on every address, speaks TLS, and lets in its list alone', async function (t) {
    const echo = net.createServer(v => v.pipe(v));
    await new Promise(v => echo.listen(0, '127.0.0.1', v));
    t.after(() => echo.close());
    const port = await port_free();
    const made = tls_cert_make('mongodb-1', ['127.0.0.1']);
    const dial = {port: echo.address().port};
    t.after(() => agent_forwards_set([], 'test'));

    const said = await agent_forwards_set([{name: 'mongodb-1 → the internet', port, host: '0.0.0.0', tls: {cert: made.cert, key: made.key}, dial}], 'test');
    assert.deepStrictEqual(said, {'mongodb-1 → the internet': {at: `0.0.0.0:${port}`, error: null}});
    assert.strictEqual(await over_tls(port, made.ca, 'ping'), 'ping', 'through TLS to the server\'s port');
    await assert.rejects(plain(port, 'ping'), 'a plain client gets no answer');

    // Who may connect: an address not on the list is closed before its handshake
    await agent_forwards_set([{name: 'mongodb-1 → the internet', port, host: '0.0.0.0', tls: {cert: made.cert, key: made.key}, allow: ['192.0.2.7', '10.0.0.0/8'], dial}], 'test');
    await assert.rejects(over_tls(port, made.ca, 'ping'), /ECONNRESET|socket disconnected|closed/);
    await agent_forwards_set([{name: 'mongodb-1 → the internet', port, host: '0.0.0.0', tls: {cert: made.cert, key: made.key}, allow: ['127.0.0.0/8'], dial}], 'test');
    assert.strictEqual(await over_tls(port, made.ca, 'pong'), 'pong', 'a network on the list');

    // TLS off: plain, as any forward
    await agent_forwards_set([{name: 'mongodb-1 → the internet', port, host: '0.0.0.0', dial}], 'test');
    assert.strictEqual(await plain(port, 'plain'), 'plain');

    // Out of the list: closed
    await agent_forwards_set([], 'test');
    await assert.rejects(plain(port, 'gone'), /ECONNREFUSED/);
});

// A port nobody listens on now
function port_free()
{
    return new Promise(function (resolve) {
        const probe = net.createServer();
        probe.listen(0, '127.0.0.1', function () {
            const port = probe.address().port;
            probe.close(() => resolve(port));
        });
    });
}

// What the far end sends back, over TLS checked against `ca`
function over_tls(port, ca, text)
{
    return new Promise(function (resolve, reject) {
        const client = tls.connect({host: '127.0.0.1', port, ca}, () => client.write(text));
        client.on('data', function (v) {
            resolve(String(v));
            client.end();
        });
        client.on('error', reject);
        client.on('close', () => reject(new Error('closed')));
    });
}

// The same, with no TLS: a TLS port answers nothing a plain client can read back, and closes
function plain(port, text)
{
    return new Promise(function (resolve, reject) {
        const client = net.connect({host: '127.0.0.1', port}, () => client.write(text));
        client.setTimeout(3000, () => client.destroy(new Error('no answer')));
        client.on('data', function (v) {
            const answer = String(v);
            client.end();
            if (answer === text) {
                resolve(answer);
                return;
            }
            reject(new Error(`another answer: ${JSON.stringify(answer.slice(0, 20))}`));
        });
        client.on('error', reject);
        client.on('close', () => reject(new Error('closed')));
    });
}
