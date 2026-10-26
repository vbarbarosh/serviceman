const assert = require('assert');
const service_copy_start = require('../src/main/src/helpers/service_copy_start');
const stream = require('stream');
const tar_counted = require('../src/main/src/helpers/tar_counted');
const tar_stream = require('../src/main/src/helpers/tar_stream');
const test = require('node:test');
const timers = require('timers/promises');

// A file of the tar: its bytes, as tar_stream asks for them
function file_item(file_path, text)
{
    const bytes = Buffer.from(text);
    return {path: file_path, mode: 0o644, mtime_s: 0, size: bytes.length, stream: () => stream.Readable.from([bytes])};
}

async function bytes_of(readable)
{
    const chunks = [];
    for await (const chunk of readable) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

test('a tar counted on its way is the same tar, and says its bytes, its files and the one on its way', async function () {
    const items = [
        {path: 'bin', dir: true, mtime_s: 0},
        file_item('bin/run', '#!/bin/sh\nexec node index.js\n'),
        file_item('index.js', 'x'.repeat(1300)),
        file_item(`${'deep/'.repeat(30)}long.txt`, 'a name over a hundred bytes'),
    ];
    const plain = await bytes_of(tar_stream(items));
    assert.strictEqual(tar_counted.size_of(items), plain.length);
    const copy = {bytes_done: 0, files_done: 0, now: null};
    const seen = [];
    const counted = tar_counted(tar_stream(items), items, copy);
    const chunks = [];
    for await (const chunk of counted) {
        chunks.push(chunk);
        seen.push(`${copy.files_done} ${(copy.now === null) ? '' : copy.now.label}`);
    }
    assert.ok(Buffer.concat(chunks).equals(plain), 'the bytes pass as they are');
    assert.strictEqual(copy.bytes_done, plain.length);
    assert.strictEqual(copy.files_done, 3);
    assert.ok(seen.includes('1 index.js'), seen.join(' | '));
    assert.deepStrictEqual(copy.now, {label: `${'deep/'.repeat(30)}long.txt`, size: 27, done: 27});
});

test('a tar that fails fails what it answers with', async function () {
    const items = [file_item('a.txt', 'a')];
    const tar = tar_stream(items);
    const counted = tar_counted(tar, items, {bytes_done: 0, files_done: 0, now: null});
    tar.destroy(new Error('the sender hung up'));
    await assert.rejects(bytes_of(counted), /the sender hung up/);
});

test('a service\'s copy is kept on it with the speed across it, and goes when it ends', async function () {
    const service = {state: {copy: null}};
    const stop = service_copy_start(service, {title: 'New version to vps1', unit: 'file', files: 3, files_done: 0, bytes: 3000, bytes_done: 0, ratio: null, now: null});
    const copy = service.state.copy;
    assert.strictEqual(copy.title, 'New version to vps1');
    for (let i = 1; i <= 25; i++) {
        copy.bytes_done = i*100;
        await timers.setTimeout(100);
    }
    assert.ok(copy.samples.length >= 1, 'the graph has its points');
    assert.ok(copy.samples.every(v => (v.x > 0) && (v.x <= 1) && (v.y > 0)), JSON.stringify(copy.samples));
    assert.ok(copy.samples.at(-1).y > 500, `about a thousand bytes a second: ${copy.samples.at(-1).y}`);
    stop();
    assert.strictEqual(service.state.copy, null);
});
