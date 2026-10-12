const agent_fs_tree = require('../src/agent/src/agent_fs_tree');
const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const test = require('node:test');

test('a tree says every name at any depth by its type, a link as a link, and leaves out what it skips', async function (t) {
    const dir = dir_make(t);
    const outside = dir_make(t);
    fs.writeFileSync(path.join(outside, 'not-mine.txt'), 'x');
    fs.mkdirSync(path.join(dir, 'a', 'b', 'c'), {recursive: true});
    fs.mkdirSync(path.join(dir, 'a', 'node_modules', 'x'), {recursive: true});
    fs.mkdirSync(path.join(dir, 'empty'));
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref');
    fs.writeFileSync(path.join(dir, 'top.txt'), 'top');
    fs.writeFileSync(path.join(dir, 'a', 'b', 'c', 'deep.txt'), 'deep');
    fs.writeFileSync(path.join(dir, 'a', 'node_modules', 'x', 'skipped.js'), 'x');
    fs.writeFileSync(path.join(dir, 'a', 'привет файл.txt'), 'hi');
    fs.symlinkSync(outside, path.join(dir, 'a', 'to-outside'));
    fs.symlinkSync('nowhere', path.join(dir, 'broken'));

    // A socket is no file and no folder: other
    const server = net.createServer();
    await new Promise(v => server.listen(path.join(dir, 'a.sock'), v));
    t.after(() => server.close());

    const said = await tree_read({path: dir, skip: ['node_modules', '.git']});
    assert.deepStrictEqual(said[0], {type: 'start', path: dir});
    const items = said.slice(1, -1);
    assert.deepStrictEqual(items.map(v => `${v.type} ${v.path}`).sort(), [
        'dir a',
        'dir a/b',
        'dir a/b/c',
        'dir empty',
        'file a/b/c/deep.txt',
        'file a/привет файл.txt',
        'file top.txt',
        'link a/to-outside',
        'link broken',
        'other a.sock',
    ]);
    assert.deepStrictEqual(items.find(v => v.path === 'a/to-outside').target, outside, 'a link is said, never followed');
    assert.deepStrictEqual(items.find(v => v.path === 'broken').target, 'nowhere');
    const stat = fs.statSync(path.join(dir, 'a', 'b', 'c', 'deep.txt'));
    assert.deepStrictEqual(items.find(v => v.path === 'a/b/c/deep.txt'), {type: 'file', path: 'a/b/c/deep.txt', size: 4, mtime_ms: Math.round(stat.mtimeMs)});
    assert.deepStrictEqual(Object.keys(items.find(v => v.path === 'a/to-outside')), ['type', 'path', 'size', 'mtime_ms', 'target']);
    assert.deepStrictEqual(items.find(v => v.path === 'empty'), {type: 'dir', path: 'empty', size: null, mtime_ms: Math.round(fs.lstatSync(path.join(dir, 'empty')).mtimeMs)});
    assert.deepStrictEqual([said.at(-1).type, said.at(-1).hashed], ['end', 0]);

    // A path without a root is under the home folder, as for every other name the host gives
    const home = await tree_read({path: path.relative(os.homedir(), dir)});
    assert.strictEqual(home[0].path, dir);
});

test('a hash is sha256sum\'s, read once while the file keeps its size, time and inode', async function (t) {
    const dir = dir_make(t);
    fs.writeFileSync(path.join(dir, 'small.txt'), 'hello');
    fs.writeFileSync(path.join(dir, 'big.bin'), Buffer.alloc(3*1024*1024, 7));
    fs.writeFileSync(path.join(dir, 'empty.txt'), '');
    const first = await tree_read({path: dir, hash: true});
    for (const item of first.filter(v => v.type === 'file')) {
        const summed = child_process.execFileSync('sha256sum', [path.join(dir, item.path)], {encoding: 'utf8'}).slice(0, 64);
        assert.strictEqual(item.sha256, summed, item.path);
    }
    assert.strictEqual(first.at(-1).hashed, 3);

    // Nothing changed: no file is read again
    const reads = agent_fs_tree.reads;
    assert.strictEqual((await tree_read({path: dir, hash: true})).at(-1).hashed, 0);
    assert.strictEqual(agent_fs_tree.reads, reads);

    // A new time is read again, and so is a file put in place with the same size and time,
    // as rsync -t does: a new inode
    const time = fs.statSync(path.join(dir, 'small.txt')).mtime;
    fs.utimesSync(path.join(dir, 'empty.txt'), time, new Date(time.getTime() + 5000));
    fs.writeFileSync(path.join(dir, 'small.new'), 'HELLO');
    fs.utimesSync(path.join(dir, 'small.new'), time, time);
    fs.renameSync(path.join(dir, 'small.new'), path.join(dir, 'small.txt'));
    const third = await tree_read({path: dir, hash: true});
    assert.strictEqual(third.at(-1).hashed, 2);
    assert.strictEqual(third.find(v => v.path === 'small.txt').sha256, child_process.execFileSync('sha256sum', [path.join(dir, 'small.txt')], {encoding: 'utf8'}).slice(0, 64));
});

test('what cannot be read is said and the walk goes on; a tree that is not a folder is an error', {skip: (process.getuid() === 0) ? 'root reads every folder' : false}, async function (t) {
    const dir = dir_make(t);
    fs.mkdirSync(path.join(dir, 'closed'));
    fs.writeFileSync(path.join(dir, 'closed', 'secret.txt'), 's');
    fs.writeFileSync(path.join(dir, 'locked.txt'), 'l');
    fs.writeFileSync(path.join(dir, 'open.txt'), 'o');
    fs.chmodSync(path.join(dir, 'closed'), 0);
    fs.chmodSync(path.join(dir, 'locked.txt'), 0);
    try {
        const said = await tree_read({path: dir, hash: true});
        // The reason alone, never the machine's full path
        assert.deepStrictEqual(said.filter(v => v.type === 'error'), [{type: 'error', path: 'closed', error: 'EACCES: permission denied'}]);
        assert.ok(said.some(v => (v.type === 'dir') && (v.path === 'closed')), 'a folder that cannot be read is still a folder');
        const locked = said.find(v => v.path === 'locked.txt');
        assert.deepStrictEqual([locked.type, locked.sha256, locked.error], ['file', null, 'EACCES: permission denied']);
        assert.strictEqual(said.find(v => v.path === 'open.txt').sha256.length, 64);
    }
    finally {
        fs.chmodSync(path.join(dir, 'closed'), 0o755);
    }

    await assert.rejects(tree_read({path: path.join(dir, 'open.txt')}), /is not a folder/);
    await assert.rejects(tree_read({path: path.join(dir, 'nothing')}), /ENOENT/);
});

async function tree_read(target)
{
    let text = '';
    for await (const chunk of agent_fs_tree(target)) {
        text += chunk.toString('utf8');
    }
    return text.trim().split('\n').map(v => JSON.parse(v));
}

function dir_make(t)
{
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tree-'));
    t.after(() => fs.rmSync(out, {recursive: true, force: true}));
    return out;
}
