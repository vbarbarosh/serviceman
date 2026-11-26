const assert = require('assert');
const crypto = require('crypto');
const test = require('node:test');
const tls = require('tls');
const tls_cert_make = require('../src/main/src/helpers/tls_cert_make');

// A public port's certificates: an authority of its own and a server certificate it signs, for the
// addresses and names given. A client that trusts the authority's file talks to the server; one
// that does not is turned away, as it is by a server it cannot check.
test('a public port\'s certificate is its own authority\'s, for the addresses it is reached at', async function (t) {
    const made = tls_cert_make('mongodb-1', ['127.0.0.1', '2001:db8::5', 'db.example.com']);
    const ca = new crypto.X509Certificate(made.ca);
    const chain = made.cert.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----\n/g);
    assert.strictEqual(chain.length, 2, 'the server\'s, then the authority\'s');
    assert.strictEqual(chain[1], made.ca);
    const cert = new crypto.X509Certificate(chain[0]);
    assert.deepStrictEqual([ca.ca, cert.ca], [true, false]);
    assert.deepStrictEqual([ca.subject, cert.subject], ['CN=mongodb-1 authority', 'CN=mongodb-1']);
    assert.strictEqual(cert.subjectAltName, 'IP Address:127.0.0.1, IP Address:2001:DB8:0:0:0:0:0:5, DNS:db.example.com');
    assert.deepStrictEqual([cert.checkIssued(ca), cert.verify(ca.publicKey), ca.verify(ca.publicKey)], [true, true, true]);
    assert.ok(new Date(cert.validTo) > new Date(Date.now() + 9*365*24*60*60*1000), 'ten years');
    assert.ok(new Date(cert.validFrom) < new Date(), 'already valid');
    assert.match(made.key, /^-----BEGIN PRIVATE KEY-----\n/);

    const server = tls.createServer({key: made.key, cert: made.cert}, v => v.end('hello\n'));
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(() => server.close());
    const port = server.address().port;
    assert.strictEqual(await said(port, made.ca), 'hello\n', 'trusted by its authority\'s file');
    await assert.rejects(said(port, undefined), /self-signed certificate in certificate chain/, 'and not without it');
    const other = tls_cert_make('mongodb-2', ['127.0.0.1']);
    await assert.rejects(said(port, other.ca), /self-signed certificate in certificate chain|unable to verify/, 'nor by another server\'s authority');
    // Whether two makes share anything: never their keys
    assert.notStrictEqual(other.key, made.key);
});

// What a TLS client that trusts `ca` reads from the server, or why it would not connect
function said(port, ca)
{
    return new Promise(function (resolve, reject) {
        const client = tls.connect({host: '127.0.0.1', port, ca, servername: undefined});
        const chunks = [];
        client.on('data', v => chunks.push(v));
        client.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        client.on('error', reject);
    });
}
