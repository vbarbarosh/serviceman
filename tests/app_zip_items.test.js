const app_zip_items = require('../src/main/src/helpers/app_zip_items');
const assert = require('assert');
const test = require('node:test');
const zip_bytes = require('./fixtures/zip_bytes');

const RUN = Buffer.from('#!/bin/sh\nexec node server.js\n');
const SCRIPT = Buffer.from('#!/bin/sh\n');

test('a zip of an app folder is read as the page reads one: its one top folder stripped, data/ left out and counted, modes kept or guessed', function () {
    const zip = zip_bytes([
        {name: 'lab/', bytes: null},
        {name: 'lab/bin/', bytes: null},
        {name: 'lab/bin/run', bytes: RUN, mode: 0o755},
        {name: 'lab/server.js', bytes: Buffer.from('x'), mode: 0},
        {name: 'lab/tools/go.sh', bytes: SCRIPT, mode: 0},
        {name: 'lab/bin/build', bytes: SCRIPT, mode: 0},
        {name: 'lab/data/', bytes: null},
        {name: 'lab/data/kept.txt', bytes: Buffer.from('mine')},
    ]);
    const read = app_zip_items('lab.zip', zip);
    assert.deepStrictEqual(read.items.map(v => [v.path, v.dir ? 'dir' : v.mode.toString(8)]), [['bin/', 'dir'], ['bin/run', '755'], ['server.js', '644'], ['tools/go.sh', '755'], ['bin/build', '755']]);
    assert.deepStrictEqual([read.files, read.bytes, read.data_files, read.configure, read.build], [4, RUN.length + 1 + SCRIPT.length*2, 1, false, true]);
    assert.strictEqual(read.items[1].bytes.equals(RUN), true);
    assert.strictEqual(read.items[1].mtime_s > 0, true, 'the time the zip keeps');
});

test('bin/run at the top is the app as it is, whatever is beside it; a zip with no data/ says so', function () {
    const read = app_zip_items('lab.zip', zip_bytes([{name: 'bin/run', bytes: RUN}, {name: 'notes/', bytes: null}, {name: 'notes/x.txt', bytes: Buffer.from('x')}]));
    assert.deepStrictEqual(read.items.map(v => v.path), ['bin/run', 'notes/', 'notes/x.txt']);
    assert.deepStrictEqual([read.files, read.data_files], [2, null]);
});

// What the page says of a folder or a zip it will not send, said here with the zip's name, and
// before anything of it is sent: the name walks out, the list lies about a size, the zip is
// not one
test('a zip that is no app, or one made to do harm, is refused with a sentence', function () {
    const cases = [
        [[], /^Error: lab\.zip is empty\.$/],
        [[{name: 'a/', bytes: null}, {name: 'b/', bytes: null}, {name: 'a/bin/run', bytes: RUN}], /^Error: lab\.zip has no bin\/run, at its top or in its one folder/],
        [[{name: 'lab/bin/run', bytes: RUN}, {name: 'lab/current', bytes: Buffer.from('v1'), link: true}], /^Error: lab\.zip holds links, which are not sent/],
        [[{name: 'lab/bin/run', bytes: RUN}, {name: 'lab/../escape.sh', bytes: RUN}], /^Error: lab\.zip names lab\/\.\.\/escape\.sh, which leads outside the folder\.$/],
        [[{name: 'bin/run', bytes: RUN}, {name: '/etc/passwd', bytes: RUN}], /names \/etc\/passwd, which leads outside the folder/],
        [[{name: 'lab/bin/run', bytes: RUN, size: 2}], /^Error: lab\.zip: lab\/bin\/run does not unpack as the zip says/],
        [[{name: 'lab/bin/run', bytes: RUN, size: 0x7fffffff}], /^Error: lab\.zip: its files come to more than \d+ bytes unpacked/],
    ];
    for (const [files, re] of cases) {
        assert.throws(() => app_zip_items('lab.zip', zip_bytes(files)), re, JSON.stringify(files.map(v => v.name)));
    }
    assert.throws(() => app_zip_items('lab.zip', Buffer.from('not a zip at all')), /^Error: lab\.zip: it is not a zip: it has no list of its files at its end$/);
    assert.throws(() => app_zip_items('lab.zip', Buffer.alloc(0)), /it is not a zip/);
});
