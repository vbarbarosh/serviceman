const agent_fs_room = require('../src/agent/src/agent_fs_room');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

test('the room of a folder is the free bytes and inodes of its disk; a folder not made yet is measured at its nearest one', async function (t) {
    const dir = dir_make(t);
    const stat = fs.statfsSync(dir);
    const room = await agent_fs_room({path: dir});
    assert.ok(room.bytes_free > 0);
    // Another program writes to the same disk meanwhile; a few MB either way is the same disk
    assert.ok(Math.abs(room.bytes_free - stat.bavail*stat.bsize) < 64*1024*1024);
    // A disk that counts no inodes (btrfs) says null
    if (stat.files === 0) {
        assert.strictEqual(room.inodes_free, null);
    }
    else {
        assert.ok(room.inodes_free > 0);
    }

    // What an upload makes is measured where it will land
    const unmade = await agent_fs_room({path: path.join(dir, 'new', 'deep')});
    assert.ok(Math.abs(unmade.bytes_free - room.bytes_free) < 64*1024*1024);
    assert.strictEqual(fs.existsSync(path.join(dir, 'new')), false, 'measuring makes nothing');

    // ~ and a path with no root are the home of the agent's user, as for every other name
    const home = fs.statfsSync(os.homedir());
    assert.ok(Math.abs((await agent_fs_room({path: '~'})).bytes_free - home.bavail*home.bsize) < 64*1024*1024);
    assert.ok((await agent_fs_room({path: 'no-such-folder-here/x'})).bytes_free > 0);
});

function dir_make(t)
{
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-room-'));
    t.after(() => fs.rmSync(out, {recursive: true, force: true}));
    return out;
}
