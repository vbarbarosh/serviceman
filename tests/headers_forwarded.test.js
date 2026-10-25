const assert = require('assert');
const headers_forwarded = require('../src/main/src/headers_forwarded');
const test = require('node:test');

// The page's own cookie is for the control door alone: a service published under the control
// host is sent every other cookie, and never that one
test('the forwarded headers carry the visitor\'s cookies but the page\'s own', function () {
    const both = headers_forwarded(request({cookie: 'theme=dark; serviceman_token=sm_secret; lang=en'}));
    assert.strictEqual(both.cookie, 'theme=dark; lang=en');
    assert.strictEqual(JSON.stringify(both).includes('sm_secret'), false);
    const only = headers_forwarded(request({cookie: 'serviceman_token=sm_secret'}));
    assert.strictEqual('cookie' in only, false, 'no cookie header at all');
    const none = headers_forwarded(request({accept: 'text/html'}));
    assert.strictEqual('cookie' in none, false);
    assert.strictEqual(none.accept, 'text/html');
    const odd = headers_forwarded(request({cookie: ' a=1;;serviceman_token = x ; b=2 '}));
    assert.strictEqual(odd.cookie, 'a=1; b=2');
});

function request(headers)
{
    return {headers: Object.assign({host: 'app.serviceman.localhost'}, headers), socket: {remoteAddress: '127.0.0.1', encrypted: false}};
}
