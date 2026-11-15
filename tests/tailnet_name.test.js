const assert = require('assert');
const tailnet_name_read = require('../src/main/src/helpers/tailnet_name_read');
const test = require('node:test');

// serviceman's own name on the tailnet, from what `tailscale status --json` says of itself: the
// name a new agent is told to dial
test('serviceman\'s tailnet name is read from tailscale\'s answer, without the dot DNS ends it with', function () {
    const name_of = tailnet_name_read.name_of;
    assert.strictEqual(name_of(JSON.stringify({Self: {DNSName: 'serviceman.tail1234.ts.net.'}})), 'serviceman.tail1234.ts.net');
    assert.strictEqual(name_of(JSON.stringify({Self: {DNSName: 'serviceman.tail1234.ts.net'}})), 'serviceman.tail1234.ts.net');
    assert.strictEqual(name_of(JSON.stringify({Self: {DNSName: ''}})), null, 'not on a tailnet yet');
    assert.strictEqual(name_of(JSON.stringify({Self: {}})), null);
    assert.strictEqual(name_of(JSON.stringify({})), null);
    assert.strictEqual(name_of('not json'), null);
    assert.strictEqual(name_of(JSON.stringify({Self: {DNSName: 'evil.example"><script>.'}})), null, 'nothing but a name goes into a command');
});
