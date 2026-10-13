const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

test('the files go as a tar that GNU tar unpacks whole: long names, names not in ascii, an empty file, sizes not of 512', async function (t) {
    const tar_blob = (await import('../ui/tar_blob.js')).default;
    const deep = `${'a-very-long-folder-name/'.repeat(6)}третий уровень/the-file.txt`;
    const entries = [
        {file: new File(['hello'], 'a.txt', {lastModified: 1760000000000}), name: 'a.txt'},
        {file: new File([new Uint8Array(1000).fill(7)], 'b.bin'), name: 'photos/2024/b.bin'},
        {file: new File([], 'empty.txt'), name: 'photos/empty.txt'},
        {file: new File(['deep'], 'the-file.txt'), name: deep},
    ];
    const {blob, ends} = tar_blob(entries);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tar-blob-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    fs.writeFileSync(path.join(dir, 'x.tar'), Buffer.from(await blob.arrayBuffer()));
    fs.mkdirSync(path.join(dir, 'out'));
    child_process.execFileSync('tar', ['-xf', path.join(dir, 'x.tar'), '-C', path.join(dir, 'out')]);
    const unpacked = path.join(dir, 'out');
    assert.strictEqual(fs.readFileSync(path.join(unpacked, 'a.txt'), 'utf8'), 'hello');
    assert.strictEqual(fs.statSync(path.join(unpacked, 'a.txt')).mtimeMs, 1760000000000);
    assert.deepStrictEqual(fs.readFileSync(path.join(unpacked, 'photos/2024/b.bin')), Buffer.alloc(1000, 7));
    assert.strictEqual(fs.statSync(path.join(unpacked, 'photos/empty.txt')).size, 0);
    assert.strictEqual(fs.readFileSync(path.join(unpacked, deep), 'utf8'), 'deep');
    // Each file's bytes end where `ends` says: its header, then its bytes
    assert.strictEqual(ends[0], 512 + 5);
    assert.strictEqual(ends[1], 1024 + 512 + 1000);
    assert.strictEqual(blob.size % 512, 0);
});
