const assert = require('assert');
const stream = require('stream');
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

// What a machine says once a file is in is its own word. Read with a bare JSON.parse inside the
// stream's listener, where nothing catches, an answer that is no JSON ended the process.
test('a machine\'s answer to a file that is no JSON object fails the write and names the machine', async function () {
    for (const said of ['oops, not json', 'null', '"in"']) {
        const disk = disk_whose_machine_says(said);
        await assert.rejects(disk.write('/home/user', 'a.txt', stream.Readable.from([Buffer.from('a')])), {message: 'vps1: the machine said of the file what is no JSON object'}, said);
        await assert.rejects(disk.part_write('/home/user', 'a.txt', 'abcdefgh', 0, stream.Readable.from([Buffer.from('a')])), {message: 'the machine said of the file what is no JSON object'}, said);
        await assert.rejects(disk.write_tar('/home/user', stream.Readable.from([Buffer.from('a')])), {message: 'the machine said of the file what is no JSON object'}, said);
    }
    const disk = disk_whose_machine_says('{"path":"/home/user/a.txt","size":1}\n');
    assert.deepStrictEqual(await disk.write('/home/user', 'a.txt', stream.Readable.from([Buffer.from('a')])), {path: '/home/user/a.txt', size: 1});
});

// The disk of vps1, its link stood in for: whatever is sent is swallowed, then `said` comes back
function disk_whose_machine_says(said)
{
    const tunnel_open_path = require.resolve('../src/main/src/helpers/tunnel_open');
    const remote_disk_path = require.resolve('../src/main/src/helpers/remote_disk');
    require.cache[tunnel_open_path] = {id: tunnel_open_path, filename: tunnel_open_path, loaded: true, exports: function () {
        return new stream.Duplex({
            read: function () {},
            write: function (chunk, encoding, callback) {
                callback();
            },
            final: function (callback) {
                this.push(said);
                this.push(null);
                callback();
            },
        });
    }};
    delete require.cache[remote_disk_path];
    const remote_disk = require('../src/main/src/helpers/remote_disk');
    return remote_disk({}, {name: 'vps1'});
}

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
