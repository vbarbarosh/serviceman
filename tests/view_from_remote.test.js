const assert = require('assert');
const test = require('node:test');
const view_from_remote = require('../src/main/src/helpers/view_from_remote');

// The page puts a zip of an app in the folder its machine's agent installs into: an agent that
// says where that is is believed, one too old to say installs into services/ under its own folder
test('a machine names the folder its agent installs into, an older agent the one it used', function () {
    const remote = remote_make({dir: '/home/user/serviceman-agent/', services: '/srv/apps'});
    assert.strictEqual(view_from_remote(remote).machine.services, '/srv/apps');
    delete remote.state.resources.services;
    assert.strictEqual(view_from_remote(remote).machine.services, '/home/user/serviceman-agent/services');
    delete remote.state.resources.dir;
    assert.strictEqual(view_from_remote(remote).machine.services, null);
});

// The agent says its name and address on the tailnet; the view keeps a name that is a name and
// an address that is an address, and says null for an agent too old to say
test('a machine shows its tailnet name and address as its agent said them', function () {
    const remote = remote_make({tailnet: {name: 'laptop.tail1234.ts.net', ip: '100.64.0.21'}});
    assert.deepStrictEqual(view_from_remote(remote).machine.tailnet, {name: 'laptop.tail1234.ts.net', ip: '100.64.0.21'});
    remote.state.resources.tailnet = {name: '<script>', ip: '100.64.0.21'};
    assert.deepStrictEqual(view_from_remote(remote).machine.tailnet, {name: null, ip: '100.64.0.21'});
    remote.state.resources.tailnet = null;
    assert.strictEqual(view_from_remote(remote).machine.tailnet, null);
    delete remote.state.resources.tailnet;
    assert.strictEqual(view_from_remote(remote).machine.tailnet, null);
});

function remote_make(resources)
{
    return {
        name: 'laptop',
        title: null,
        tags: [],
        state: {
            phase: 'online',
            declared: [],
            streams: {},
            connected_at: null,
            stats: null,
            resources: Object.assign({hostname: 'laptop', platform: 'Linux', arch: 'x64', node: 'v24', cpu: {count: 1, model: 'cpu'}, mem: {total: 1}, disk: {path: '/', total: 1, free: 1}}, resources),
        },
    };
}
