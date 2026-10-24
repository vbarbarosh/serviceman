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
