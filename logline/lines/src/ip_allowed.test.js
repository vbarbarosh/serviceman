const assert = require('assert');
const ip_allowed = require('./ip_allowed');
const test = require('node:test');

test('an address is allowed by itself, by a range around it, and by nothing else', function () {
    assert.strictEqual(ip_allowed('100.64.0.20', ['100.64.0.20']), true);
    assert.strictEqual(ip_allowed('100.64.0.21', ['100.64.0.20']), false);
    // The whole tailnet
    assert.strictEqual(ip_allowed('100.64.0.20', ['100.64.0.0/10']), true);
    assert.strictEqual(ip_allowed('100.128.0.1', ['100.64.0.0/10']), false);
    // How node names an IPv4 caller on a server that listens on both
    assert.strictEqual(ip_allowed('::ffff:100.64.0.20', ['100.64.0.20']), true);
    assert.strictEqual(ip_allowed('fd7a:115c:a1e0::20', ['fd7a:115c:a1e0::/48']), true);
    assert.strictEqual(ip_allowed('fd7a:115c:a1e1::1', ['fd7a:115c:a1e0::/48']), false);
    assert.strictEqual(ip_allowed('fd7a:115c:a1e0::20', ['fd7a:115c:a1e0::20']), true);
    // An IPv4 range says nothing about IPv6 callers, and the other way round
    assert.strictEqual(ip_allowed('::1', ['0.0.0.0/0']), false);
    assert.strictEqual(ip_allowed('127.0.0.1', ['::/0']), false);
    // What cannot be read allows nothing
    assert.strictEqual(ip_allowed('100.64.0.20', ['100.64.0.0/40', 'nonsense']), false);
    assert.strictEqual(ip_allowed('nonsense', ['0.0.0.0/0']), false);
});
