const agent_disk_usage = require('../src/agent/src/agent_disk_usage');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Where a disk's space went: a folder's own folders by size, biggest first, what lies in it
// apart, and a folder the agent cannot read named, since its size is then in no folder
test('a folder is counted as its folders, biggest first, its own files apart, and what cannot be read named', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-usage-'));
    t.after(function () {
        fs.chmodSync(path.join(dir, 'locked'), 0o755);
        fs.rmSync(dir, {recursive: true, force: true});
    });
    fs.mkdirSync(path.join(dir, 'logs/old'), {recursive: true});
    fs.mkdirSync(path.join(dir, 'cache'));
    fs.mkdirSync(path.join(dir, 'locked'));
    fs.writeFileSync(path.join(dir, 'logs/old/big.log'), Buffer.alloc(3*1024*1024, 1));
    fs.writeFileSync(path.join(dir, 'cache/small'), Buffer.alloc(256*1024, 1));
    fs.writeFileSync(path.join(dir, 'locked/secret'), Buffer.alloc(64*1024, 1));
    fs.writeFileSync(path.join(dir, 'here.bin'), Buffer.alloc(512*1024, 1));
    fs.chmodSync(path.join(dir, 'locked'), 0o000);

    const answer = await agent_disk_usage({path: `${dir}/`}, {docker: 'docker'});
    assert.strictEqual(answer.path, dir);
    assert.deepStrictEqual(answer.folders.map(v => path.basename(v.path)).slice(0, 2), ['logs', 'cache']);
    assert.ok(answer.folders[0].size >= 3*1024*1024, 'the log under logs/old counts in logs');
    assert.ok((answer.files >= 512*1024) && (answer.files < 1024*1024), 'here.bin is the folder\'s own');
    assert.strictEqual(answer.total, answer.files + answer.folders.reduce((sum, v) => sum + v.size, 0));
    if (process.getuid() !== 0) {
        assert.deepStrictEqual(answer.unread, [path.join(dir, 'locked')]);
    }
    assert.strictEqual(answer.extras, null, 'docker and the journal only when asked');
    await assert.rejects(agent_disk_usage({path: 'var/log'}, {}), /from the root/);
});
