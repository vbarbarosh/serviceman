const assert = require('assert');
const path = require('path');
const tar_parser = require('../modules/file_manager/server/tar_parser');
const test = require('node:test');
const zlib = require('zlib');

const PUBLIC = path.join(__dirname, '..', 'src', 'main', 'public');

// The page sends a zip dropped on the New service form to a machine as its files: it reads the
// zip itself and writes them as one tar for the File Manager's upload, with the modes the zip
// kept, so bin/run arrives able to run
test('a zip read in the page comes out as a tar of the same files, with their modes', async function () {
    const zip_entries = (await import(path.join(PUBLIC, 'zip_entries.js'))).default;
    const tar_blob = (await import(path.join(PUBLIC, 'tar_blob.js'))).default;
    const long = `appdir/${'deep/'.repeat(25)}file.txt`;
    const zip = zip_make([
        {name: 'appdir/', mode: 0o40755},
        {name: 'appdir/bin/run', mode: 0o100755, text: '#!/bin/sh\nexec node server.js\n'},
        {name: 'appdir/server.js', mode: 0o100644, text: 'require("http");\n'.repeat(50)},
        {name: 'appdir/README', mode: 0o100644, text: 'stored as it is', stored: true},
        {name: long, mode: 0o100600, text: 'far down'},
    ]);
    const entries = await zip_entries(new Blob([zip]));
    assert.deepStrictEqual(entries.map(v => [v.name, v.dir, v.link, v.mode]), [
        ['appdir/', true, false, 0o755],
        ['appdir/bin/run', false, false, 0o755],
        ['appdir/server.js', false, false, 0o644],
        ['appdir/README', false, false, 0o644],
        [long, false, false, 0o600],
    ]);
    assert.strictEqual(Buffer.from(await entries[2].bytes()).toString(), 'require("http");\n'.repeat(50), 'a deflated file');
    assert.strictEqual(Buffer.from(await entries[3].bytes()).toString(), 'stored as it is', 'a stored one');

    const items = [];
    for (const entry of entries.slice(1)) {
        items.push({path: entry.name.slice('appdir/'.length), mode: entry.mode, mtime_s: entry.mtime_s, bytes: await entry.bytes()});
    }
    items.unshift({path: 'bin', dir: true, mtime_s: 0});
    const tar = Buffer.from(await tar_blob(items).arrayBuffer());
    const read = tar_read(tar);
    assert.deepStrictEqual(read.map(v => [v.type, v.name, v.mode]), [
        ['dir', 'bin', undefined],
        ['file', 'bin/run', 0o755],
        ['file', 'server.js', 0o644],
        ['file', 'README', 0o644],
        ['file', long.slice('appdir/'.length), 0o600],
    ]);
    assert.strictEqual(read[1].text, '#!/bin/sh\nexec node server.js\n');
    assert.strictEqual(read[4].text, 'far down', 'a name past ustar\'s hundred bytes keeps its prefix');
});

test('what is not a zip is said to be one it cannot read', async function () {
    const zip_entries = (await import(path.join(PUBLIC, 'zip_entries.js'))).default;
    await assert.rejects(zip_entries(new Blob(['just some text, not a zip'])), /it is not a zip/);
});

// A zip as `zip` on unix makes one: each file's local header and bytes, then the list of them
// with their unix modes, then the end record
function zip_make(files)
{
    const locals = [];
    const listed = [];
    let offset = 0;
    for (const file of files) {
        const name = Buffer.from(file.name);
        const raw = Buffer.from(file.text || '');
        const stored = (file.stored === true) || (raw.length === 0);
        const packed = stored ? raw : zlib.deflateRawSync(raw);
        const crc = zlib.crc32(raw);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(stored ? 0 : 8, 8);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(name.length, 26);
        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50, 0);
        entry.writeUInt16LE((3 << 8) | 20, 4);
        entry.writeUInt16LE(20, 6);
        entry.writeUInt16LE(stored ? 0 : 8, 10);
        // 2026-10-23 12:00:00, as DOS keeps it
        entry.writeUInt16LE(12 << 11, 12);
        entry.writeUInt16LE(((2026 - 1980) << 9) | (10 << 5) | 23, 14);
        entry.writeUInt32LE(crc, 16);
        entry.writeUInt32LE(packed.length, 20);
        entry.writeUInt32LE(raw.length, 24);
        entry.writeUInt16LE(name.length, 28);
        entry.writeUInt32LE((file.mode << 16) >>> 0, 38);
        entry.writeUInt32LE(offset, 42);
        locals.push(local, name, packed);
        listed.push(entry, name);
        offset += local.length + name.length + packed.length;
    }
    const list = Buffer.concat(listed);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(list.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat(locals.concat([list, end]));
}

// The tar as the File Manager's upload reads it: its entries, a file's bytes as text
function tar_read(tar)
{
    const parser = tar_parser();
    const out = [];
    for (const piece of parser.push(tar)) {
        if ((piece.type === 'dir') || (piece.type === 'file')) {
            out.push({type: piece.type, name: piece.name, mode: piece.mode, text: ''});
        }
        if (piece.type === 'data') {
            out[out.length - 1].text += Buffer.from(piece.bytes).toString();
        }
    }
    assert.strictEqual(parser.end(), null, 'the tar ends where it should');
    return out;
}

// A folder picked in the page comes as files with their paths and no modes: it is judged as a
// zip is, under its one top folder, and its files reach the tar as they are, read only then
test('a folder picked in the page is an app as a zip is, and goes into the tar file by file', async function () {
    const app_folder_read = (await import(path.join(PUBLIC, 'app_folder_read.js'))).default;
    const tar_blob = (await import(path.join(PUBLIC, 'tar_blob.js'))).default;
    const picked = [
        {path: 'notes/bin/run', file: new File(['#!/bin/sh\nexec node server.js\n'], 'run', {lastModified: 1761300000000})},
        {path: 'notes/bin/configure', file: new File(['#!/bin/sh\n'], 'configure')},
        {path: 'notes/server.js', file: new File(['require("http");\n'], 'server.js')},
    ];
    const app = app_folder_read(picked);
    assert.deepStrictEqual([app.label, app.top, app.files, app.configure, app.build, app.problem], ['notes/', 'notes/', 3, true, false, null]);
    assert.strictEqual(app.size, 30 + 10 + 17);
    const items = [];
    for (const entry of app.entries) {
        items.push({path: entry.name.slice(app.top.length), mode: 0o644, mtime_s: entry.mtime_s, bytes: await entry.bytes()});
    }
    const read = tar_read(Buffer.from(await tar_blob(items).arrayBuffer()));
    assert.deepStrictEqual(read.map(v => [v.name, v.text]), [
        ['bin/run', '#!/bin/sh\nexec node server.js\n'],
        ['bin/configure', '#!/bin/sh\n'],
        ['server.js', 'require("http");\n'],
    ]);

    const empty = app_folder_read([]);
    assert.match(empty.problem, /is empty/);
    const no_run = app_folder_read([{path: 'site/index.html', file: new File(['<p>'], 'index.html')}]);
    assert.match(no_run.problem, /^site\/ has no bin\/run/);
});

// A new version's own data/ stays on this computer: a zip's folder entries and a picked
// folder's files under data/ are set apart, the rest is read again as the app, and the page is
// told how many files data/ held
test('a new version is sent without its own data/, and says how many files that held', async function () {
    const app_data_apart = (await import(path.join(PUBLIC, 'app_data_apart.js'))).default;
    const app_folder_read = (await import(path.join(PUBLIC, 'app_folder_read.js'))).default;
    const app_zip_read = (await import(path.join(PUBLIC, 'app_zip_read.js'))).default;

    const zipped = await app_zip_read(new File([zip_make([
        {name: 'lab/', mode: 0o40755},
        {name: 'lab/bin/run', mode: 0o100755, text: '#!/bin/sh\n'},
        {name: 'lab/presets/1080x1080.json', mode: 0o100644, text: '{}'},
        {name: 'lab/data/', mode: 0o40755},
        {name: 'lab/data/settings.json', mode: 0o100600, text: '{"key": "secret"}'},
        {name: 'lab/data/presets/old/config.json', mode: 0o100644, text: '{}'},
        {name: 'lab/database.txt', mode: 0o100644, text: 'not data/'},
    ])], 'lab.zip'));
    const apart = app_data_apart(zipped);
    assert.strictEqual(apart.data_files, 2);
    assert.deepStrictEqual(apart.app.entries.map(v => v.name), ['lab/', 'lab/bin/run', 'lab/presets/1080x1080.json', 'lab/database.txt']);
    assert.deepStrictEqual([apart.app.label, apart.app.top, apart.app.files, apart.app.size, apart.app.problem], ['lab.zip', 'lab/', 3, 10 + 2 + 9, null]);

    const picked = app_folder_read([
        {path: 'notes/bin/run', file: new File(['#!/bin/sh\n'], 'run')},
        {path: 'notes/data/logs/app.log', file: new File(['a line\n'], 'app.log')},
    ]);
    const folder = app_data_apart(picked);
    assert.strictEqual(folder.data_files, 1);
    assert.deepStrictEqual(folder.app.entries.map(v => v.name), ['notes/bin/run']);

    const none = app_folder_read([{path: 'notes/bin/run', file: new File(['#!/bin/sh\n'], 'run')}]);
    assert.deepStrictEqual(app_data_apart(none), {app: none, data_files: null}, 'a version with no data/ is sent as it is');
});
