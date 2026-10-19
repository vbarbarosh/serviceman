const assert = require('assert');
const from_loopback_page = require('../src/main/src/helpers/from_loopback_page');
const test = require('node:test');

test('a page loaded from localhost or a name under it may send a key, as docker\'s bridge shows it', function () {
    assert.strictEqual(from_loopback_page(request('http://serviceman.localhost:8081')), true);
    assert.strictEqual(from_loopback_page(request('http://localhost:3001')), true);
    assert.strictEqual(from_loopback_page(request('http://127.0.0.1:3001')), true);
    assert.strictEqual(from_loopback_page(request('http://[::1]:3001')), true);
});

test('a page from anywhere else, no Origin, a bad one, or a request through a machine\'s link may not', function () {
    assert.strictEqual(from_loopback_page(request('http://192.0.2.6:3001')), false);
    assert.strictEqual(from_loopback_page(request('http://localhost.example.com')), false);
    assert.strictEqual(from_loopback_page(request(undefined)), false);
    assert.strictEqual(from_loopback_page(request('null')), false);
    assert.strictEqual(from_loopback_page(request('http://serviceman.localhost:8081', 'phone')), false);
});

function request(origin, tunnel_from)
{
    return {headers: (origin === undefined) ? {} : {origin}, socket: {remoteAddress: '172.17.0.1', tunnel_from}};
}
