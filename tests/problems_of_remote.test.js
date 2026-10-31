const assert = require('assert');
const remote_state = require('../src/main/src/helpers/remote_state');
const test = require('node:test');

// The shared folders' home is root's alone: an agent that runs as a user may not open what its
// containers mount, and asking it again every minute wrote four refusals a minute into both logs
test('a mount the agent may not open is asked once a link, a missing one every time', async function () {
    const asked = stub('remote_call', async function (app, remote, method, params) {
        if (params.path.startsWith('/var/lib/serviceman/shared/home/')) {
            throw new Error(`EACCES: permission denied, stat '${params.path}'`);
        }
        if (params.path === '/home/user/gone') {
            throw new Error(`ENOENT: no such file or directory, stat '${params.path}'`);
        }
        return {};
    });
    stub('docker_exec_connect', function () {
        return {};
    });
    stub('engine_json', async function () {
        return [{Id: 'c1', Names: ['/redis'], State: 'running', Mounts: [
            {Type: 'bind', Source: '/var/lib/serviceman/shared/home/redis'},
            {Type: 'bind', Source: '/home/user/gone'},
            {Type: 'bind', Source: '/home/user/here'},
        ]}];
    });
    const problems_of_remote = require('../src/main/src/helpers/problems_of_remote');
    const remote = {name: 'vps1', state: remote_state()};
    const first = await problems_of_remote({}, remote);
    const second = await problems_of_remote({}, remote);
    assert.deepStrictEqual(asked, [
        '/var/lib/serviceman/shared/home/redis', '/home/user/gone', '/home/user/here',
        '/home/user/gone', '/home/user/here',
    ], 'the refused one is not asked again on the same link');
    assert.deepStrictEqual([first.problems.length, second.problems.length], [1, 1], 'the missing one is still a problem, the refused one never is');
    remote.state.stat_refused = {};
    await problems_of_remote({}, remote);
    assert.strictEqual(asked.filter(v => v.startsWith('/var/lib/')).length, 2, 'a new link asks it again');
});

function stub(name, fn)
{
    const out = [];
    const file = require.resolve(`../src/main/src/helpers/${name}`);
    const exports = (name === 'remote_call') ? function (app, remote, method, params) {
        out.push(params.path);
        return fn(app, remote, method, params);
    } : fn;
    require.cache[file] = {id: file, filename: file, loaded: true, exports};
    return out;
}
