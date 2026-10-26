const assert = require('assert');
const child_process = require('child_process');
const file_manager_serve = require('../server/file_manager_serve');
const file_manager_transfers_serve = require('../server/file_manager_transfers_serve');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const stream = require('stream');
const tar_parser = require('../server/tar_parser');
const test = require('node:test');
const timers = require('timers/promises');
const transfer_queue = require('../server/transfer_queue');

test('every door of the API answers from the disk it was given, under the base the host mounts it at', async function (t) {
    const disk = disk_in_memory({
        '/home/me/hello.txt': 'hello world',
        '/home/me/привет.txt': 'hi',
        '/home/me/page.html': '<p>a page</p>',
        '/home/me/empty.txt': '',
        '/home/me/inner/deep.txt': 'deep',
    });
    const logged = [];
    const running = await serve(t, {disk, name: 'box', log: (event_name, fields) => logged.push([event_name, fields])});

    // A folder, and the disk's own starting folder when none is named
    const listed = await call(running, 'GET', '/fs?path=/home/me');
    assert.strictEqual(listed.status, 200);
    assert.deepStrictEqual(JSON.parse(listed.body).items.map(v => v.name), ['inner', 'empty.txt', 'hello.txt', 'page.html', 'привет.txt']);
    assert.strictEqual(JSON.parse((await call(running, 'GET', '/fs')).body).path, '/home/me');

    // A file as itself, a name that is not ascii, HEAD, and ranges
    const whole = await call(running, 'GET', '/fs/file/home/me/hello.txt');
    assert.deepStrictEqual([whole.status, whole.body, whole.headers['content-type'], whole.headers['accept-ranges']], [200, 'hello world', 'text/plain; charset=utf-8', 'bytes']);
    const page = await call(running, 'GET', '/fs/file/home/me/page.html');
    assert.strictEqual(page.headers['content-type'], 'text/html; charset=utf-8', 'a page opens as a page');
    assert.strictEqual(page.headers['content-security-policy'], undefined, 'on an origin of its own, as itself');
    // On the host's own origin a page in a file would be the owner's page: it is sandboxed there
    const boxed = await serve(t, {disk, name: 'box', sandbox: true, log: () => {}});
    const sandboxed = await call(boxed, 'GET', '/fs/file/home/me/page.html');
    assert.deepStrictEqual([sandboxed.status, sandboxed.headers['content-security-policy'], sandboxed.body], [200, 'sandbox', '<p>a page</p>']);
    const named = await call(running, 'GET', `/fs/file/home/me/${encodeURIComponent('привет.txt')}`);
    assert.strictEqual(named.body, 'hi');
    assert.match(named.headers['content-disposition'], /^inline; filename="_\.txt"; filename\*=UTF-8''%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82\.txt$/);
    const weighed = await call(running, 'HEAD', '/fs/file/home/me/hello.txt');
    assert.deepStrictEqual([weighed.status, weighed.headers['content-length'], weighed.body], [200, '11', '']);
    const piece = await call(running, 'GET', '/fs/file/home/me/hello.txt', null, {range: 'bytes=1-3'});
    assert.deepStrictEqual([piece.status, piece.body, piece.headers['content-range']], [206, 'ell', 'bytes 1-3/11']);
    const tail = await call(running, 'GET', '/fs/file/home/me/hello.txt', null, {range: 'bytes=-2'});
    assert.deepStrictEqual([tail.status, tail.body], [206, 'ld']);
    const past = await call(running, 'GET', '/fs/file/home/me/hello.txt', null, {range: 'bytes=99-'});
    assert.deepStrictEqual([past.status, past.headers['content-range']], [416, 'bytes */11']);
    const empty = await call(running, 'GET', '/fs/file/home/me/empty.txt');
    assert.deepStrictEqual([empty.status, empty.body], [200, '']);
    const folder = await call(running, 'GET', '/fs/file/home/me/inner');
    assert.strictEqual(folder.status, 400, 'a folder comes as a tar');
    const missing = await call(running, 'GET', '/fs/file/home/me/nothing.txt');
    assert.deepStrictEqual([missing.status, JSON.parse(missing.body).error], [502, 'ENOENT: /home/me/nothing.txt']);

    // Several names as one download, saved under the folder's name, or the host's for the root
    const tar = await call(running, 'GET', '/fs/tar?dir=/home/me&names=inner&names=hello.txt');
    assert.deepStrictEqual([tar.status, tar.body], [200, 'tar of /home/me: inner hello.txt']);
    assert.match(tar.headers['content-disposition'], /^attachment; filename="me\.tar"/);
    const root_tar = await call(running, 'HEAD', '/fs/tar?dir=/&names=home');
    assert.match(root_tar.headers['content-disposition'], /^attachment; filename="box\.tar"/);
    const refused_tar = await call(running, 'GET', '/fs/tar?dir=/home/me');
    assert.deepStrictEqual([refused_tar.status, JSON.parse(refused_tar.body).error], [502, 'nothing is named to take']);

    // A file in, under a name of its own and nothing that walks out of its folder
    const landed = await call(running, 'POST', '/fs/upload?dir=/home/me&name=new.txt', 'new text');
    assert.deepStrictEqual([landed.status, JSON.parse(landed.body)], [200, {path: '/home/me/new.txt', bytes: 8, replaced: false}]);
    assert.strictEqual((await call(running, 'GET', '/fs/file/home/me/new.txt')).body, 'new text');
    const walked = await call(running, 'POST', `/fs/upload?dir=/home/me&name=${encodeURIComponent('../x')}`, 'x');
    assert.strictEqual(walked.status, 400);
    const nowhere = await call(running, 'POST', '/fs/upload?name=x.txt', 'x');
    assert.deepStrictEqual([nowhere.status, JSON.parse(nowhere.body).error], [400, 'a folder is required']);

    // A folder made, a name carried to another, a name taken away; a body that is not json
    assert.strictEqual((await call(running, 'POST', '/fs/mkdir', JSON.stringify({path: '/home/me/made/deep'}))).status, 200);
    assert.strictEqual((await call(running, 'POST', '/fs/rename', JSON.stringify({from: '/home/me/new.txt', to: '/home/me/made/new.txt'}))).status, 200);
    assert.strictEqual((await call(running, 'POST', '/fs/delete', JSON.stringify({path: '/home/me/hello.txt'}))).status, 200);
    assert.deepStrictEqual(Object.keys(disk.files).sort(), ['/home/me/empty.txt', '/home/me/inner/deep.txt', '/home/me/made/deep/', '/home/me/made/new.txt', '/home/me/page.html', '/home/me/привет.txt']);
    assert.strictEqual((await call(running, 'POST', '/fs/rename', 'not json')).status, 400);

    // An address under the base that is no door, or a door asked the wrong way
    const nothing = await call(running, 'GET', '/fs/nothing');
    assert.deepStrictEqual([nothing.status, JSON.parse(nothing.body).error], [404, 'no such door: /fs/nothing']);
    assert.strictEqual((await call(running, 'POST', '/fs')).status, 404);

    // What was done, for the host's log
    assert.deepStrictEqual(logged.map(v => v[0]), ['file_read', 'file_read', 'file_read', 'file_read', 'file_read', 'file_read', 'file_read', 'file_copied', 'file_read', 'fs_folder_made', 'fs_renamed', 'fs_deleted']);
    assert.deepStrictEqual(logged[7][1], {path: '/home/me/new.txt', bytes: 8});
});

test('a file in parts: how much is in, a part sent again, a finish only when whole, a cancel', async function (t) {
    const disk = disk_in_memory({'/home/me/old.txt': 'x'});
    const running = await serve(t, {disk});
    function at(more) {
        return `dir=/home/me&name=film.bin&id=u1abcdef9${more}`;
    }

    assert.deepStrictEqual(JSON.parse((await call(running, 'GET', `/fs/upload/part?${at('')}`)).body), {received: 0});
    assert.deepStrictEqual(JSON.parse((await call(running, 'POST', `/fs/upload/part?${at('&offset=0')}`, 'abc')).body), {received: 3});
    // The answer to a part was lost, and it is sent again from where it began
    assert.deepStrictEqual(JSON.parse((await call(running, 'POST', `/fs/upload/part?${at('&offset=1')}`, 'BCD')).body), {received: 4});
    const past = await call(running, 'POST', `/fs/upload/part?${at('&offset=9')}`, 'z');
    assert.strictEqual(past.status, 502);
    assert.strictEqual((await call(running, 'POST', `/fs/upload/part?${at('&offset=-1')}`, 'z')).status, 400);
    assert.strictEqual((await call(running, 'POST', `/fs/upload/finish?${at('&size=5')}`)).status, 502);
    const done = await call(running, 'POST', `/fs/upload/finish?${at('&size=4')}`);
    assert.deepStrictEqual(JSON.parse(done.body), {path: '/home/me/film.bin', bytes: 4, replaced: false});
    assert.strictEqual(disk.files['/home/me/film.bin'], 'aBCD');

    await call(running, 'POST', '/fs/upload/part?dir=/home/me&name=gone.bin&id=u2abcdef9&offset=0', 'xyz');
    assert.strictEqual((await call(running, 'POST', '/fs/upload/cancel?dir=/home/me&name=gone.bin&id=u2abcdef9')).status, 200);
    assert.deepStrictEqual(disk.parts, {});

    // An id that is not letters and digits, a name that walks out, no folder
    assert.strictEqual((await call(running, 'GET', '/fs/upload/part?dir=/home/me&name=x&id=../x')).status, 400);
    assert.strictEqual((await call(running, 'GET', `/fs/upload/part?dir=/home/me&name=${encodeURIComponent('../x')}&id=u3abcdef9`)).status, 400);
    assert.strictEqual((await call(running, 'GET', '/fs/upload/part?name=x&id=u3abcdef9')).status, 400);

    // A disk that keeps no parts says so, and the page sends the file in one piece
    const whole = disk_in_memory({});
    delete whole.part_write;
    const plain = await serve(t, {disk: whole});
    assert.strictEqual((await call(plain, 'GET', `/fs/upload/part?${at('')}`)).status, 501);
});

test('a copy between two disks goes in parts, waits for a disk that is away, and carries on where it stood', async function () {
    const film = 'f'.repeat(95);
    const a = disk_in_memory({'/a/film.bin': film});
    const b = disk_in_memory({'/b/keep.txt': 'k'});
    const away = {a: false, b: true};
    const logged = [];
    const queue = transfer_queue({disk_of: v => away[v] ? null : {a, b}[v], log: v => logged.push(v), part_bytes: 10});

    // The disk it goes to is away at first; once back, the third part fails as a dropped link
    const item = queue.add({disk: 'a', path: '/a/film.bin'}, {disk: 'b', dir: '/b'});
    await until(() => item.phase === 'retrying');
    assert.match(item.said, /b cannot be reached/);
    away.b = false;
    const write = b.part_write;
    let parts = 0;
    b.part_write = function (...args) {
        parts++;
        if (parts === 3) {
            return Promise.reject(new Error('the link dropped'));
        }
        return write(...args);
    };
    await until(() => item.phase === 'ok', 10000);
    assert.strictEqual(b.files['/b/film.bin'], film);
    assert.strictEqual(item.size, 95);
    assert.ok(parts > 10, 'every part, the failed one sent again');
    assert.deepStrictEqual(b.parts, {});
    assert.deepStrictEqual(logged, ['transfer_begin', 'transfer_end_ok']);

    // A file that is not there is an error at once; a copy given up while it waits is cancelled
    const missing = queue.add({disk: 'a', path: '/a/none.bin'}, {disk: 'b', dir: '/b'});
    await until(() => missing.phase === 'error');
    assert.match(missing.said, /ENOENT/);
    away.b = true;
    const waiting = queue.add({disk: 'a', path: '/a/film.bin'}, {disk: 'b', dir: '/c'});
    await until(() => waiting.phase === 'retrying');
    assert.strictEqual(queue.cancel(waiting.id), true);
    await until(() => waiting.phase === 'cancelled');
    queue.clear();
    assert.deepStrictEqual(queue.items, []);
});

test('a folder goes whole: small files in a tar, a big one in parts across a drop, empty folders, run bits and links', async function () {
    const big = 'b'.repeat(45);
    const a = disk_that_copies_folders({
        '/a/proj/run.sh': 'echo hi\n',
        '/a/proj/src/deep/x.js': 'x',
        '/a/proj/src/y.js': '',
        '/a/proj/big.bin': big,
        '/a/proj/empty/': '',
        '/a/proj/-rf': 'a name like an option',
    });
    a.modes['/a/proj/run.sh'] = 0o755;
    a.links['/a/proj/lib'] = 'src';
    const b = disk_that_copies_folders({'/b/proj/keep.txt': 'kept', '/b/proj/src/y.js': 'old'});
    const logged = [];
    const queue = transfer_queue({disk_of: v => ({a, b}[v]), log: (event_name, fields) => logged.push([event_name, fields]), part_bytes: 10, small_bytes: 20});

    // The big file's second part fails as a dropped link, and the copy carries on from there
    const write = b.part_write;
    let parts = 0;
    b.part_write = function (...args) {
        parts++;
        if (parts === 2) {
            return Promise.reject(new Error('the link dropped'));
        }
        return write(...args);
    };
    const item = queue.add({disk: 'a', path: '/a/proj/'}, {disk: 'b', dir: '/b'});
    await until(() => (item.phase === 'ok') || (item.phase === 'error'), 10000);
    assert.deepStrictEqual([item.phase, item.said, item.name, item.path], ['ok', '', 'proj', '/b/proj']);
    assert.deepStrictEqual([item.files, item.files_done, item.size, item.received], [5, 5, 8 + 1 + 0 + 45 + 21, 75]);
    assert.strictEqual(b.files['/b/proj/big.bin'], big);
    assert.strictEqual(b.files['/b/proj/src/deep/x.js'], 'x');
    assert.strictEqual(b.files['/b/proj/-rf'], 'a name like an option');
    assert.strictEqual(b.files['/b/proj/src/y.js'], '', 'a file there already is written over');
    assert.strictEqual(b.files['/b/proj/keep.txt'], 'kept', 'a folder there already is added to, not emptied');
    assert.strictEqual(b.files['/b/proj/empty/'], '');
    assert.strictEqual(b.modes['/b/proj/run.sh'], 0o755);
    assert.deepStrictEqual(b.links, {'/b/proj/lib': 'src'});
    assert.deepStrictEqual(b.tars, ['/b', '/b']);
    assert.ok(parts > 5, 'every part of the big file, the failed one sent again');
    assert.deepStrictEqual(b.parts, {});
    assert.deepStrictEqual(logged.map(v => v[0]), ['transfer_begin', 'transfer_end_ok']);
    assert.deepStrictEqual(logged[1][1], {id: item.id, path: '/b/proj', files: 5, bytes: 75, left: 0});
    assert.strictEqual(item.walk, null, 'the walk is let go once the copy is over');

    // Agents of before: every file alone, empty folders made one by one, the links left out
    // and said; a file that cannot be read is left out, and the rest lands
    const c = disk_that_copies_folders({});
    c.can = function () {
        return false;
    };
    a.can = function () {
        return false;
    };
    const read = a.read;
    a.read = function (asked, range) {
        if (asked === '/a/proj/src/deep/x.js') {
            throw new Error('EACCES: permission denied');
        }
        return read(asked, range);
    };
    const old = queue.add({disk: 'a', path: '/a/proj'}, {disk: 'c', dir: '/c'});
    const queue_old = transfer_queue({disk_of: v => ({a, c}[v]), part_bytes: 10});
    queue.cancel(old.id);
    const plain = queue_old.add({disk: 'a', path: '/a/proj'}, {disk: 'c', dir: '/c'});
    await until(() => (plain.phase === 'ok') || (plain.phase === 'error'), 10000);
    assert.deepStrictEqual([plain.phase, plain.files_done, c.tars], ['ok', 4, []]);
    assert.strictEqual(plain.said, "1 name could not be copied · 1 link left out: c's agent makes no links yet");
    assert.deepStrictEqual(plain.left.names, [{path: 'src/deep/x.js', said: 'EACCES: permission denied'}]);
    assert.strictEqual(c.files['/c/proj/run.sh'], 'echo hi\n');
    assert.strictEqual(c.files['/c/proj/empty/'], '');
    assert.deepStrictEqual(c.links, {});

    // A folder into itself never starts; one given up halfway says how many files landed
    const itself = queue_old.add({disk: 'a', path: '/a/proj'}, {disk: 'a', dir: '/a/proj/src'});
    await until(() => itself.phase === 'error');
    assert.strictEqual(itself.said, 'a folder is not copied into itself');
    // The part on its way when Cancel comes hangs, as a link that went quiet does; Cancel ends it
    const c_write = c.part_write;
    let written = 0;
    c.part_write = function (dir, name, id, offset, source) {
        written++;
        if (written > 3) {
            return new Promise((resolve, reject) => source.on('error', reject));
        }
        return c_write(dir, name, id, offset, source);
    };
    const stopped = queue_old.add({disk: 'a', path: '/a/proj'}, {disk: 'c', dir: '/d'});
    await until(() => written > 3);
    queue_old.cancel(stopped.id);
    await until(() => stopped.phase === 'cancelled');
    assert.match(stopped.said, /^[1-4] of 5 files landed$/);
    assert.deepStrictEqual(c.parts, {}, 'the part on its way is taken away');
});

// The page draws a copy between machines as it draws every copy: the speed across it and the
// file on its way, kept by the queue, so a page opened halfway sees the graph from the start
test('a copy keeps the speed across it and what is on its way, a big file counted as it flows', async function () {
    const film = 'f'.repeat(60);
    const a = disk_that_copies_folders({'/a/film.bin': film, '/a/set/one.txt': 'one', '/a/set/two.bin': 't'.repeat(30)});
    const b = disk_that_copies_folders({});
    const queue = transfer_queue({disk_of: v => ({a, b}[v]), part_bytes: 10, small_bytes: 20});
    // A slow link: each part takes a while to land, its bytes read as they go
    const write = b.part_write;
    b.part_write = async function (dir, name, id, offset, source) {
        await new Promise(v => setTimeout(v, 450));
        return await write(dir, name, id, offset, source);
    };
    const item = queue.add({disk: 'a', path: '/a/film.bin'}, {disk: 'b', dir: '/b'});
    await until(() => item.received >= 20, 10000);
    assert.deepStrictEqual(Object.keys(item.now).sort(), ['done', 'label', 'size']);
    assert.strictEqual(item.now.label, 'film.bin');
    assert.strictEqual(item.now.size, 60);
    await until(() => item.phase === 'ok', 10000);
    assert.strictEqual(b.files['/b/film.bin'], film);
    assert.ok(item.samples.length >= 1, 'the graph has its points');
    assert.ok(item.samples.every((v, index) => (v.x > 0) && (v.x <= 1) && ((index === 0) || (v.x >= item.samples[index - 1].x))), JSON.stringify(item.samples));
    assert.ok(item.samples.some(v => v.y > 0));

    // A folder names what of it is on its way: its small files in one tar, a big one by name.
    // The disk takes a moment to say the tar is in, so the tar can be seen on its way.
    const write_tar = b.write_tar;
    b.write_tar = async function (dir, source) {
        const written = await write_tar(dir, source);
        await new Promise(v => setTimeout(v, 300));
        return written;
    };
    const folder = queue.add({disk: 'a', path: '/a/set'}, {disk: 'b', dir: '/c'});
    const labels = new Set();
    await until(function () {
        if (folder.now !== null) {
            labels.add(`${folder.now.label} ${folder.now.size}`);
        }
        return folder.phase === 'ok';
    }, 10000);
    assert.deepStrictEqual(Array.from(labels).filter(v => v.startsWith('set/')), ['set/two.bin 30']);
    assert.ok(Array.from(labels).includes('set: 1 small file in one go 3'), Array.from(labels).join(' | '));
});

test('the copies API lists, starts, cancels and clears; a copy names known disks only', async function (t) {
    const a = disk_in_memory({'/a/film.bin': 'film'});
    const b = disk_in_memory({});
    const queue = transfer_queue({disk_of: v => ({a, b}[v] === undefined) ? null : {a, b}[v]});
    const server = http.createServer(function (req, res) {
        const pathname = new URL(req.url, 'http://test.invalid').pathname;
        file_manager_transfers_serve(req, res, {queue, tail: pathname.slice('/transfers'.length), disk_known: v => (v === 'a') || (v === 'b')});
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(() => new Promise(v => server.close(v)));
    const running = {port: server.address().port};

    assert.strictEqual((await call(running, 'POST', '/transfers', JSON.stringify({from: {disk: 'z', path: '/a/film.bin'}, to: {disk: 'b', dir: '/b'}}))).status, 400);
    assert.strictEqual((await call(running, 'POST', '/transfers', JSON.stringify({from: {disk: 'a', path: '/a/film.bin'}, to: {disk: 'b', dir: ' '}}))).status, 400);
    assert.strictEqual((await call(running, 'POST', '/transfers', 'not json')).status, 400);
    const started = JSON.parse((await call(running, 'POST', '/transfers', JSON.stringify({from: {disk: 'a', path: '/a/film.bin'}, to: {disk: 'b', dir: '/b'}}))).body);
    assert.strictEqual(started.name, 'film.bin');
    await until(() => queue.items[0].phase === 'ok');
    const listed = JSON.parse((await call(running, 'GET', '/transfers')).body).items;
    assert.deepStrictEqual([listed.length, listed[0].phase, listed[0].received, listed[0].wake], [1, 'ok', 4, undefined]);
    // What the page draws it with: the speed across it, and what was on its way last
    assert.ok(Array.isArray(listed[0].samples));
    assert.deepStrictEqual(listed[0].now, {label: 'film.bin', size: 4, done: 4});
    assert.strictEqual(b.files['/b/film.bin'], 'film');
    assert.strictEqual((await call(running, 'POST', '/transfers/abc123/cancel')).status, 404);
    assert.strictEqual((await call(running, 'POST', '/transfers/clear')).status, 200);
    assert.deepStrictEqual(JSON.parse((await call(running, 'GET', '/transfers')).body).items, []);
});

test('a whole tree is objects of one shape, as one JSON array or as events, ending with end; a disk that cannot walk one says so', async function (t) {
    const asked = [];
    const logged = [];
    const disk = {
        tree: function (dir, options) {
            asked.push([dir, options]);
            if (dir === '/nothing') {
                return stream.Readable.from((async function* () {
                    throw new Error('ENOENT: /nothing');
                })());
            }
            const lines = [
                {type: 'start', path: '/home/me'},
                {type: 'dir', path: 'b', size: null, mtime_ms: 4},
                {type: 'file', path: 'b/z.txt', size: 1, mtime_ms: 5, sha256: 'bb'},
                {type: 'file', path: 'a.txt', size: 2, mtime_ms: 6, sha256: 'aa'},
                {type: 'link', path: 'b/to', size: null, mtime_ms: 7, target: '/etc'},
                {type: 'other', path: 'b/app.sock', size: null, mtime_ms: 8},
                {type: 'file', path: 'locked.txt', size: 3, mtime_ms: 9, sha256: null, error: 'EACCES: permission denied'},
                {type: 'error', path: 'closed', error: 'EACCES: permission denied'},
            ];
            if (dir !== '/cut') {
                lines.push({type: 'end', hashed: 1, ms: 4});
            }
            // Cut anywhere, as a link cuts it
            const text = lines.map(v => `${JSON.stringify(v)}\n`).join('');
            return stream.Readable.from([text.slice(0, 50), text.slice(50, 51), text.slice(51)].map(v => Buffer.from(v)));
        },
    };
    const running = await serve(t, {disk, log: (event_name, fields) => logged.push([event_name, fields])});

    // One JSON: a bare array, sorted by path, compact, keys always in one order, end last
    const listed = await call(running, 'GET', '/fs?path=/home/me&tree=1&hash=sha256&skip=.git,node_modules&skip=dist');
    assert.strictEqual(listed.status, 200);
    assert.strictEqual(listed.body.includes('\n'), false, 'a tree comes compact, with no indents');
    assert.deepStrictEqual(JSON.parse(listed.body).map(v => JSON.stringify(v)), [
        '{"type":"file","path":"a.txt","size":2,"mtime_ms":6,"sha256":"aa"}',
        '{"type":"dir","path":"b","size":null,"mtime_ms":4}',
        '{"type":"other","path":"b/app.sock","size":null,"mtime_ms":8}',
        '{"type":"link","path":"b/to","size":null,"mtime_ms":7,"target":"/etc"}',
        '{"type":"file","path":"b/z.txt","size":1,"mtime_ms":5,"sha256":"bb"}',
        '{"type":"error","path":"closed","error":"EACCES: permission denied"}',
        '{"type":"file","path":"locked.txt","size":3,"mtime_ms":9,"sha256":null,"error":"EACCES: permission denied"}',
        '{"type":"end"}',
    ]);
    assert.deepStrictEqual(asked[0], ['/home/me', {hash: true, skip: ['.git', 'node_modules', 'dist']}]);
    await until(() => logged.length > 0);
    assert.deepStrictEqual([logged[0][0], logged[0][1].names, logged[0][1].hashed], ['tree_listed', 7, 1]);

    // The same walk as events: one plain data line an object, the very objects of the JSON
    const events = await call(running, 'GET', '/fs?path=/home/me&tree=1&hash=sha256', null, {accept: 'text/event-stream'});
    assert.deepStrictEqual([events.status, events.headers['content-type']], [200, 'text/event-stream; charset=utf-8']);
    const blocks = events.body.split('\n\n').filter(v => v !== '');
    assert.strictEqual(blocks.every(v => v.startsWith('data: {')), true, 'no event names, nothing but data');
    assert.deepStrictEqual(blocks.map(v => v.slice(6)).sort(), JSON.parse(listed.body).map(v => JSON.stringify(v)).sort());
    assert.strictEqual(blocks.at(-1), 'data: {"type":"end"}');
    assert.deepStrictEqual(asked[1], ['/home/me', {hash: true, skip: []}]);

    // A walk that stops before its end: a 502 before anything is sent; under way, an error
    // object with no path and no end
    const cut = await call(running, 'GET', '/fs?path=/cut&tree=1');
    assert.deepStrictEqual([cut.status, JSON.parse(cut.body).error], [502, 'the disk stopped before the whole tree was read']);
    const cut_events = await call(running, 'GET', '/fs?path=/cut&tree=1', null, {accept: 'text/event-stream'});
    assert.deepStrictEqual([cut_events.status, cut_events.body.split('\n\n').filter(v => v !== '').at(-1)], [200, 'data: {"type":"error","error":"the disk stopped before the whole tree was read"}']);

    // A folder that cannot be read is an error before anything is answered, in both forms
    assert.deepStrictEqual(JSON.parse((await call(running, 'GET', '/fs?path=/nothing&tree=1')).body), {error: 'ENOENT: /nothing'});
    assert.strictEqual((await call(running, 'GET', '/fs?path=/nothing&tree=1', null, {accept: 'text/event-stream'})).status, 502);

    assert.strictEqual((await call(running, 'GET', '/fs?path=/home/me&tree=1&hash=md5')).status, 400);

    // A delay spaces events out, and holds the walk meanwhile; it is for events alone
    const time0 = Date.now();
    const slow = await call(running, 'GET', '/fs?path=/home/me&tree=1&delay=60', null, {accept: 'text/event-stream'});
    assert.ok(Date.now() - time0 >= 420, 'seven names, a delay after each');
    assert.strictEqual((slow.body.match(/^data: /gm) || []).length, 8);
    for (const bad of ['delay=-1', 'delay=1001', 'delay=soon', 'delay=1.5']) {
        assert.strictEqual((await call(running, 'GET', `/fs?path=/home/me&tree=1&${bad}`, null, {accept: 'text/event-stream'})).status, 400, bad);
    }
    assert.match(JSON.parse((await call(running, 'GET', '/fs?path=/home/me&tree=1&delay=10')).body).error, /spaces events out/);

    // One JSON stops after 50,000 names and ends with an error, not end, and stops the walk;
    // events have no limit
    let read = 0;
    let destroyed = false;
    const big = await serve(t, {disk: {tree: function () {
        const out = stream.Readable.from((function* () {
            yield Buffer.from('{"type":"start","path":"/big"}\n');
            for (let i = 0; i < 60000; i++) {
                read++;
                yield Buffer.from(`{"type":"file","path":"f${String(i).padStart(5, '0')}","size":1,"mtime_ms":1}\n`);
            }
            yield Buffer.from('{"type":"end","hashed":0,"ms":1}\n');
        })());
        out.on('close', () => destroyed = true);
        return out;
    }}});
    const cut_json = JSON.parse((await call(big, 'GET', '/fs?path=/big&tree=1')).body);
    assert.deepStrictEqual([cut_json.length, cut_json.at(-2).path, cut_json.at(-1)], [50001, 'f49999', {type: 'error', error: 'more than 50000 names: the list stops here'}]);
    await until(() => destroyed);
    assert.ok(read < 60000, 'the walk stops once the answer is cut');
    const uncut = await call(big, 'GET', '/fs?path=/big&tree=1', null, {accept: 'text/event-stream'});
    assert.deepStrictEqual([(uncut.body.match(/"type":"file"/g) || []).length, uncut.body.endsWith('data: {"type":"end"}\n\n')], [60000, true]);

    // With a delay the walk itself waits: a page that leaves after a moment read a few names
    read = 0;
    destroyed = false;
    await new Promise(function (resolve) {
        const request = http.get({host: '127.0.0.1', port: big.port, path: '/fs?path=/big&tree=1&delay=20', headers: {accept: 'text/event-stream'}}, function (answer) {
            answer.resume();
            setTimeout(function () {
                request.destroy();
                resolve();
            }, 300);
        });
    });
    await until(() => destroyed);
    assert.ok(read < 1000, `the walk waited for the page: ${read} names read`);

    const plain = await serve(t, {disk: disk_in_memory({'/home/me/a.txt': 'a'})});
    assert.strictEqual((await call(plain, 'GET', '/fs?path=/home/me&tree=1')).status, 501);
    assert.strictEqual(JSON.parse((await call(plain, 'GET', '/fs?path=/home/me')).body).items.length, 1, 'without tree the list is as it was');
});

test('a folder watched comes as server-sent events, an error before the watch holds as a 502, and a closed page ends it', async function (t) {
    const opened = [];
    const disk = {
        watch: function (dir, options) {
            const out = new stream.PassThrough();
            out.asked = {dir, options};
            opened.push(out);
            return out;
        },
    };
    const logged = [];
    const running = await serve(t, {disk, log: (event_name, fields) => logged.push([event_name, fields])});

    // The answer waits for ready, then each line of the disk is one event
    const events = [];
    let status = null;
    const request = http.request({host: '127.0.0.1', port: running.port, path: '/fs/watch?path=/home/me&tree=1&skip=node_modules&skip=.git'}, function (answer) {
        status = [answer.statusCode, answer.headers['content-type']];
        answer.on('data', v => events.push(...v.toString('utf8').split('\n\n').filter(vv => vv !== '')));
    });
    request.end();
    await until(() => opened.length === 1);
    assert.deepStrictEqual(opened[0].asked, {dir: '/home/me', options: {tree: true, skip: ['node_modules', '.git']}});
    assert.strictEqual(status, null, 'nothing is answered before the watch holds');
    opened[0].write('{"type":"ready","path":"/home/me"}\n{"type":"created","path":"a.txt","kind":"file","size":1,"mtime_ms":5}\n{"type":"res');
    opened[0].write('ync","why":"lost"}\n');
    await until(() => events.length === 3);
    assert.deepStrictEqual(status, [200, 'text/event-stream; charset=utf-8']);
    assert.deepStrictEqual(events, [
        'event: ready\ndata: {"type":"ready","path":"/home/me"}',
        'event: created\ndata: {"type":"created","path":"a.txt","kind":"file","size":1,"mtime_ms":5}',
        'event: resync\ndata: {"type":"resync","why":"lost"}',
    ]);

    // The page goes: the disk's watch is closed, and the host hears how long it ran
    request.destroy();
    await until(() => opened[0].destroyed);
    await until(() => logged.length === 1);
    assert.deepStrictEqual([logged[0][0], logged[0][1].path, logged[0][1].tree, logged[0][1].events], ['folder_watched', '/home/me', true, 2]);

    // A folder that cannot be watched is an error, not an empty stream
    const refused = call(running, 'GET', '/fs/watch?path=/nothing');
    await until(() => opened.length === 2);
    opened[1].destroy(new Error('ENOENT: /nothing'));
    assert.deepStrictEqual([(await refused).status, JSON.parse((await refused).body).error], [502, 'ENOENT: /nothing']);

    // One that fails after it held says so as an event, and ends
    const failed = call(running, 'GET', '/fs/watch?path=/home/me');
    await until(() => opened.length === 3);
    opened[2].write('{"type":"ready","path":"/home/me"}\n');
    await timers.setTimeout(50);
    opened[2].destroy(new Error('/home/me is gone'));
    assert.strictEqual((await failed).body, 'event: ready\ndata: {"type":"ready","path":"/home/me"}\n\nevent: error\ndata: {"error":"/home/me is gone"}\n\n');

    // A disk that cannot watch
    const plain = await serve(t, {disk: disk_in_memory({})});
    assert.strictEqual((await call(plain, 'GET', '/fs/watch?path=/')).status, 501);
});

test('the room left on a folder\'s disk, for an upload to check it fits; a disk that cannot say answers 501, a refusal 502', async function (t) {
    const disk = disk_in_memory({'/home/me/a.txt': 'a'});
    const running = await serve(t, {disk});

    // A folder not made yet is the disk's to measure, at the nearest one that is
    const room = await call(running, 'GET', `/fs/room?path=${encodeURIComponent('/home/me/new folder')}`);
    assert.deepStrictEqual([room.status, JSON.parse(room.body)], [200, {bytes_free: 5000000000, inodes_free: 300000}]);
    assert.deepStrictEqual(disk.measured, ['/home/me/new folder']);
    assert.strictEqual((await call(running, 'POST', '/fs/room?path=/home/me')).status, 404);

    // A disk that counts no inodes says null, whatever it left out
    disk.room = async function () {
        return {bytes_free: 7};
    };
    assert.deepStrictEqual(JSON.parse((await call(running, 'GET', '/fs/room?path=/home/me')).body), {bytes_free: 7, inodes_free: null});

    // A disk that refuses
    disk.room = async function () {
        throw new Error('ENOTDIR: /home/me/a.txt/x');
    };
    const refused = await call(running, 'GET', '/fs/room?path=/home/me/a.txt/x');
    assert.deepStrictEqual([refused.status, JSON.parse(refused.body)], [502, {error: 'ENOTDIR: /home/me/a.txt/x'}]);

    // A disk that cannot say: the page uploads without asking
    const plain_disk = disk_in_memory({});
    delete plain_disk.room;
    const plain = await serve(t, {disk: plain_disk});
    const unknown = await call(plain, 'GET', '/fs/room?path=/home/me');
    assert.deepStrictEqual([unknown.status, JSON.parse(unknown.body)], [501, {error: 'this disk cannot say how much room it has'}]);
});

test('many files as one tar: written as they come, with their times; a bad name refuses the tar, before the disk is asked when it is the first', async function (t) {
    const disk = disk_in_memory({'/home/me/old.txt': 'old'});
    const logged = [];
    const running = await serve(t, {disk, log: (event_name, fields) => logged.push([event_name, fields])});

    // What GNU tar writes of a folder: files, folders inside, an empty one, a name too long
    // for ustar (././@LongLink)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-tar-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const long = `${'d'.repeat(120)}/${'f'.repeat(130)}.txt`;
    fs.mkdirSync(path.join(dir, 'a', 'b'), {recursive: true});
    fs.mkdirSync(path.join(dir, 'empty'));
    fs.mkdirSync(path.join(dir, path.dirname(long)));
    fs.writeFileSync(path.join(dir, 'a', 'b', 'deep.txt'), 'deep');
    fs.writeFileSync(path.join(dir, 'top.txt'), 'top');
    fs.writeFileSync(path.join(dir, long), 'long');
    fs.utimesSync(path.join(dir, 'top.txt'), 1600000000, 1600000000);
    const tarred = child_process.execFileSync('tar', ['-C', dir, '-cf', '-', '.']);
    const landed = await call(running, 'POST', '/fs/upload/tar?dir=/home/me/in', tarred);
    assert.deepStrictEqual([landed.status, JSON.parse(landed.body)], [200, {files: 3, bytes: 11}]);
    assert.deepStrictEqual([disk.files['/home/me/in/a/b/deep.txt'], disk.files['/home/me/in/top.txt'], disk.files[`/home/me/in/${long}`]], ['deep', 'top', 'long']);
    assert.strictEqual(disk.files['/home/me/in/empty/'], '', 'an empty folder is made');
    assert.strictEqual(disk.times['/home/me/in/top.txt'], 1600000000, 'a file keeps the time it had');
    assert.deepStrictEqual(logged, [['files_copied', {dir: '/home/me/in', files: 3, bytes: 11, ms: logged[0][1].ms}]]);

    // Written by hand: a long name, a ustar prefix, a link passed over
    const by_hand = tar_of([
        {name: '././@LongLink', type: 'L', text: `${'x'.repeat(150)}.txt\0`},
        {name: 'x'.repeat(99), text: 'long'},
        {prefix: 'p/'.repeat(60).slice(0, -1), name: 'prefixed.txt', text: 'pre', mtime: 1500000000},
        {name: 'link', type: '2'},
    ]);
    assert.deepStrictEqual(JSON.parse((await call(running, 'POST', '/fs/upload/tar?dir=/home/me/hand', by_hand)).body), {files: 2, bytes: 7});
    assert.strictEqual(disk.files[`/home/me/hand/${'x'.repeat(150)}.txt`], 'long');
    assert.strictEqual(disk.files[`/home/me/hand/${'p/'.repeat(60)}prefixed.txt`], 'pre');
    assert.strictEqual(disk.times[`/home/me/hand/${'p/'.repeat(60)}prefixed.txt`], 1500000000);

    // A first name that walks out, or is absolute: refused before the disk is asked
    const tars = disk.tars.length;
    const out_of = await call(running, 'POST', '/fs/upload/tar?dir=/home/me', tar_of([{name: '../escape.txt', text: 'x'}]));
    assert.deepStrictEqual([out_of.status, JSON.parse(out_of.body).error], [400, '"../escape.txt" walks out of the folder the tar is sent to']);
    const absolute = await call(running, 'POST', '/fs/upload/tar?dir=/home/me', tar_of([{name: '/etc/passwd', text: 'x'}]));
    assert.deepStrictEqual([absolute.status, /is an absolute name/.test(JSON.parse(absolute.body).error)], [400, true]);
    assert.strictEqual(disk.tars.length, tars, 'the disk was not asked');

    // A bad name later: what came before it is in, nothing after it
    const later = await call(running, 'POST', '/fs/upload/tar?dir=/home/me/later', tar_of([{name: 'one.txt', text: '1'}, {name: 'a/../../two.txt', text: '2'}, {name: 'three.txt', text: '3'}]));
    assert.deepStrictEqual([later.status, /walks out/.test(JSON.parse(later.body).error)], [400, true]);
    assert.deepStrictEqual(Object.keys(disk.files).filter(v => v.startsWith('/home/me/later/')), ['/home/me/later/one.txt']);
    assert.strictEqual(disk.files['/home/me/two.txt'], undefined);

    // A body that stops before the tar ends, or is no tar at all
    const whole = tar_of([{name: 'cut.txt', text: 'x'.repeat(2000)}]);
    const cut = await call(running, 'POST', '/fs/upload/tar?dir=/home/me/cut', whole.subarray(0, 1024));
    assert.deepStrictEqual([cut.status, JSON.parse(cut.body).error], [400, 'the tar was cut before its end']);
    assert.strictEqual(disk.files['/home/me/cut/cut.txt'], undefined, 'no half file');
    const junk = await call(running, 'POST', '/fs/upload/tar?dir=/home/me', Buffer.alloc(1024, 'j'));
    assert.deepStrictEqual([junk.status, /not a tar/.test(JSON.parse(junk.body).error)], [400, true]);
    assert.strictEqual((await call(running, 'POST', '/fs/upload/tar', whole)).status, 400);
    assert.strictEqual(logged.length, 2, 'one line a tar, for the two that went in');

    // A disk that refuses, and one that takes no tar
    disk.write_tar = async function () {
        throw new Error('EACCES: /home/me/locked');
    };
    const refused = await call(running, 'POST', '/fs/upload/tar?dir=/home/me/locked', whole);
    assert.deepStrictEqual([refused.status, JSON.parse(refused.body)], [502, {error: 'EACCES: /home/me/locked'}]);
    const plain_disk = disk_in_memory({});
    delete plain_disk.write_tar;
    const plain = await serve(t, {disk: plain_disk});
    const unknown = await call(plain, 'POST', '/fs/upload/tar?dir=/home/me', whole);
    assert.deepStrictEqual([unknown.status, JSON.parse(unknown.body)], [501, {error: 'this disk cannot take a tar'}]);
});

// A disk held in an object: path -> text, a folder as a path that ends in a slash or as the
// folder of a file. Enough of a disk to answer every call the way a real one does.
function disk_in_memory(files)
{
    const held = Object.assign({}, files);
    // A file in parts: what is in so far, kept by upload id
    const parts = {};
    // Every folder it was asked to measure the room of, the time each file of a tar was given,
    // and the folder of every tar it was handed
    const measured = [];
    const times = {};
    const tars = [];
    // The mode each file was given, and every link made: {path: target}
    const modes = {};
    const links = {};
    const out = {files: held, parts, measured, times, tars, modes, links};
    function folder_has(dir) {
        return Object.keys(held).some(v => v.startsWith(`${(dir === '/') ? '' : dir}/`));
    }
    function stat_of(full) {
        if (held[full] !== undefined) {
            return {kind: 'file', size: Buffer.byteLength(held[full]), mtime_ms: 0};
        }
        if ((full === '/') || folder_has(full)) {
            return {kind: 'dir', size: 0, mtime_ms: 0};
        }
        throw new Error(`ENOENT: ${full}`);
    }
    out.list = async function (asked) {
        const dir = ((asked === null) || (asked === '')) ? '/home/me' : asked;
        const names = new Set();
        for (const key of Object.keys(held)) {
            if (key.startsWith(`${dir}/`)) {
                names.add(key.slice(dir.length + 1).split('/')[0]);
            }
        }
        const items = Array.from(names).filter(v => v !== '').map(function (name) {
            const stat = stat_of(`${dir}/${name}`);
            return {name, kind: stat.kind, size: (stat.kind === 'file') ? stat.size : null, mtime_ms: 0};
        });
        items.sort((a, b) => (a.kind === b.kind) ? a.name.localeCompare(b.name) : ((a.kind === 'dir') ? -1 : 1));
        return {path: dir, items};
    };
    out.stat = async function (asked) {
        return stat_of(asked);
    };
    out.read = function (asked, range) {
        const bytes = Buffer.from(held[asked]);
        return stream.Readable.from([(range === null) ? bytes : bytes.subarray(range.start, range.end + 1)]);
    };
    out.tar = function (dir, names) {
        if (names.length === 0) {
            throw new Error('nothing is named to take');
        }
        return stream.Readable.from([Buffer.from(`tar of ${dir}: ${names.join(' ')}`)]);
    };
    out.write = async function (dir, name, req) {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        const full = `${dir}/${name}`;
        const replaced = (held[full] !== undefined);
        held[full] = Buffer.concat(chunks).toString('utf8');
        return {path: full, bytes: Buffer.byteLength(held[full]), replaced};
    };
    out.rename = async function (from, to) {
        held[to] = held[from];
        delete held[from];
        return {};
    };
    out.remove = async function (asked) {
        stat_of(asked);
        delete held[asked];
        return {};
    };
    out.mkdir = async function (asked) {
        held[`${asked}/`] = '';
        return {created: true};
    };
    // A file is held once its last byte is in, with the time the tar gives it
    out.write_tar = async function (dir, source) {
        tars.push(dir);
        const parser = tar_parser();
        const out = {files: 0, bytes: 0};
        let file = null;
        for await (const chunk of source) {
            for (const piece of parser.push(chunk)) {
                if (piece.type === 'dir') {
                    held[`${dir}/${piece.name}/`] = '';
                }
                if (piece.type === 'file') {
                    file = {full: `${dir}/${piece.name}`, mtime_s: piece.mtime_s, mode: piece.mode, chunks: []};
                }
                if (piece.type === 'data') {
                    file.chunks.push(Buffer.from(piece.bytes));
                    out.bytes += piece.bytes.length;
                }
                if (piece.type === 'file_end') {
                    held[file.full] = Buffer.concat(file.chunks).toString('utf8');
                    times[file.full] = file.mtime_s;
                    modes[file.full] = file.mode;
                    out.files += 1;
                }
            }
        }
        const refusal = parser.end();
        if (refusal !== null) {
            throw refusal;
        }
        return out;
    };
    out.room = async function (dir) {
        measured.push(dir);
        return {bytes_free: 5000000000, inodes_free: 300000};
    };
    out.part_stat = async function (dir, name, id) {
        return {received: (parts[id] === undefined) ? 0 : parts[id].length};
    };
    out.part_write = async function (dir, name, id, offset, source) {
        const had = (parts[id] === undefined) ? '' : parts[id];
        if (offset > had.length) {
            throw new Error(`the file has ${had.length} bytes so far, and a part cannot start at ${offset}`);
        }
        const chunks = [];
        for await (const chunk of source) {
            chunks.push(chunk);
        }
        parts[id] = had.slice(0, offset) + Buffer.concat(chunks).toString('utf8');
        return {received: parts[id].length};
    };
    out.part_finish = async function (dir, name, id, size, mode) {
        const have = (parts[id] === undefined) ? '' : parts[id];
        if (have.length !== size) {
            throw new Error(`the file has ${have.length} bytes so far, not ${size}`);
        }
        const full = `${dir}/${name}`;
        const replaced = (held[full] !== undefined);
        held[full] = have;
        modes[full] = mode;
        delete parts[id];
        return {path: full, bytes: size, replaced};
    };
    out.part_remove = async function (dir, name, id) {
        delete parts[id];
        return {};
    };
    return out;
}

// A disk in memory that does what an up to date agent does: a folder walked, a tar of paths, a
// link made. A key that ends with / is a folder; a file's mode is in modes, a link's target in
// links.
function disk_that_copies_folders(files)
{
    const out = disk_in_memory(files);
    const held = out.files;
    const modes = out.modes;
    const links = out.links;
    out.can = function (feature) {
        return ['folder_copy', 'tar_put'].includes(feature);
    };
    out.tree = function (dir) {
        const lines = [{type: 'start', path: dir}];
        const names = Object.keys(held).concat(Object.keys(links)).filter(v => v.startsWith(`${dir}/`)).sort();
        const dirs = new Set();
        for (const full of names) {
            const rel = full.slice(dir.length + 1).replace(/\/$/, '');
            const parts = rel.split('/');
            for (let i = 1; i < parts.length; i++) {
                dirs.add(parts.slice(0, i).join('/'));
            }
            if (full.endsWith('/')) {
                dirs.add(rel);
            }
            else if (links[full] !== undefined) {
                lines.push({type: 'link', path: rel, size: null, mtime_ms: 0, target: links[full]});
            }
            else {
                lines.push({type: 'file', path: rel, size: Buffer.byteLength(held[full]), mtime_ms: 0, mode: (modes[full] === undefined) ? 0o644 : modes[full]});
            }
        }
        for (const rel of dirs) {
            lines.push({type: 'dir', path: rel, size: null, mtime_ms: 0});
        }
        lines.push({type: 'end', hashed: 0, ms: 0});
        return stream.Readable.from([Buffer.from(lines.map(v => `${JSON.stringify(v)}\n`).join(''))]);
    };
    const tar_names = out.tar;
    out.tar = function (dir, names, options) {
        if ((options === undefined) || (options.paths !== true)) {
            return tar_names(dir, names);
        }
        const entries = names.map(function (name) {
            const full = `${dir}/${name}`;
            if (held[`${full}/`] !== undefined) {
                return {name: `./${name}/`, type: '5'};
            }
            return {name: `./${name}`, text: held[full], mode: modes[full]};
        });
        return stream.Readable.from([tar_of(entries)]);
    };
    out.link_create = async function (asked, target) {
        links[asked] = target;
        return {created: true};
    };
    return out;
}

// A tar written by hand, entry by entry: {name, prefix, type, text, mtime, mode}, then its end
function tar_of(entries)
{
    const blocks = [];
    for (const entry of entries) {
        const data = Buffer.from((entry.text === undefined) ? '' : entry.text);
        const header = Buffer.alloc(512);
        header.write(entry.name, 0, 100, 'utf8');
        header.write(`${((entry.mode === undefined) ? 0o644 : entry.mode).toString(8).padStart(7, '0')}\0`, 100, 'latin1');
        header.write('0000000\0', 108, 'latin1');
        header.write('0000000\0', 116, 'latin1');
        header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
        header.write(`${((entry.mtime === undefined) ? 0 : entry.mtime).toString(8).padStart(11, '0')}\0`, 136, 'latin1');
        header.write('        ', 148, 'latin1');
        header.write((entry.type === undefined) ? '0' : entry.type, 156, 'latin1');
        header.write('ustar\0', 257, 'latin1');
        header.write('00', 263, 'latin1');
        if (entry.prefix !== undefined) {
            header.write(entry.prefix, 345, 155, 'utf8');
        }
        let sum = 0;
        for (const byte of header) {
            sum += byte;
        }
        header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
        blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
    }
    blocks.push(Buffer.alloc(1024));
    return Buffer.concat(blocks);
}

// The module mounted at /fs on a server of its own, the way a host mounts it
async function serve(t, options)
{
    const server = http.createServer(function (req, res) {
        const pathname = new URL(req.url, 'http://test.invalid').pathname;
        if ((pathname !== '/fs') && (pathname.startsWith('/fs/') === false)) {
            res.writeHead(404);
            res.end();
            return;
        }
        file_manager_serve(req, res, Object.assign({tail: pathname.slice('/fs'.length)}, options));
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(() => new Promise(v => server.close(v)));
    return {port: server.address().port};
}

function call(running, method, path, body, headers)
{
    return new Promise(function (resolve, reject) {
        const request = http.request({host: '127.0.0.1', port: running.port, method, path, headers}, function (answer) {
            const chunks = [];
            answer.on('data', v => chunks.push(v));
            answer.on('end', () => resolve({status: answer.statusCode, headers: answer.headers, body: Buffer.concat(chunks).toString('utf8')}));
        });
        request.on('error', reject);
        request.end(((body === undefined) || (body === null)) ? undefined : body);
    });
}

async function until(ok, timeout_ms)
{
    const deadline = Date.now() + ((timeout_ms === undefined) ? 5000 : timeout_ms);
    while (ok() === false) {
        if (Date.now() > deadline) {
            throw new Error('waited too long');
        }
        await new Promise(v => setTimeout(v, 20));
    }
}
