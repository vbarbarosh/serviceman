const assert = require('assert');
const test = require('node:test');

// A delete walks the whole folder, an app's node_modules too: the host waits as long as the
// agent works, since a delete given up on goes on deleting under whatever is written there next
test('a delete waits minutes for the machine, a listing seconds', async function () {
    const asked = stub_remote_call();
    const remote_disk = require('../src/main/src/helpers/remote_disk');
    const disk = remote_disk({}, {name: 'vps1'});
    await disk.remove('/home/user/serviceman-agent/services/ai-lab.new');
    await disk.list('/home/user');
    await disk.stat('/home/user/serviceman-agent/services/ai-lab.new');
    assert.deepStrictEqual(asked, [['fs_delete', 600000], ['fs_list', 15000], ['fs_stat', 15000]]);
});

function stub_remote_call()
{
    const out = [];
    const remote_call_path = require.resolve('../src/main/src/helpers/remote_call');
    require.cache[remote_call_path] = {id: remote_call_path, filename: remote_call_path, loaded: true, exports: async function (app, remote, method, params, timeout_ms) {
        out.push([method, timeout_ms]);
        return {};
    }};
    return out;
}
