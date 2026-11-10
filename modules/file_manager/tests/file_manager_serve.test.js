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
        '/home/user/hello.txt': 'hello world',
        '/home/user/привет.txt': 'hi',
        '/home/user/page.html': '<p>a page</p>',
        '/home/user/empty.txt': '',
        '/home/user/inner/deep.txt': 'deep',
    });
    const logged = [];
    const running = await serve(t, {disk, name: 'box', log: (event_name, fields) => logged.push([event_name, fields])});

    // A folder, and the disk's own starting folder when none is named
    const listed = await call(running, 'GET', '/fs?path=/home/user');
    assert.strictEqual(listed.status, 200);
    assert.deepStrictEqual(JSON.parse(listed.body).items.map(v => v.name), ['inner', 'empty.txt', 'hello.txt', 'page.html', 'привет.txt']);
    assert.strictEqual(JSON.parse((await call(running, 'GET', '/fs')).body).path, '/home/user');

    // A file as itself, a name that is not ascii, HEAD, and ranges
    const whole = await call(running, 'GET', '/fs/file/home/user/hello.txt');
    assert.deepStrictEqual([whole.status, whole.body, whole.headers['content-type'], whole.headers['accept-ranges']], [200, 'hello world', 'text/plain; charset=utf-8', 'bytes']);
    const page = await call(running, 'GET', '/fs/file/home/user/page.html');
    assert.strictEqual(page.headers['content-type'], 'text/html; charset=utf-8', 'a page opens as a page');
    assert.strictEqual(page.headers['content-security-policy'], undefined, 'on an origin of its own, as itself');
    // On the host's own origin a page in a file would be the owner's page: it is sandboxed there
    const boxed = await serve(t, {disk, name: 'box', sandbox: true, log: () => {}});
    const sandboxed = await call(boxed, 'GET', '/fs/file/home/user/page.html');
    assert.deepStrictEqual([sandboxed.status, sandboxed.headers['content-security-policy'], sandboxed.body], [200, 'sandbox', '<p>a page</p>']);
    const named = await call(running, 'GET', `/fs/file/home/user/${encodeURIComponent('привет.txt')}`);
    assert.strictEqual(named.body, 'hi');
    assert.match(named.headers['content-disposition'], /^inline; filename="_\.txt"; filename\*=UTF-8''%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82\.txt$/);
    const weighed = await call(running, 'HEAD', '/fs/file/home/user/hello.txt');
    assert.deepStrictEqual([weighed.status, weighed.headers['content-length'], weighed.body], [200, '11', '']);
    const piece = await call(running, 'GET', '/fs/file/home/user/hello.txt', null, {range: 'bytes=1-3'});
    assert.deepStrictEqual([piece.status, piece.body, piece.headers['content-range']], [206, 'ell', 'bytes 1-3/11']);
    const tail = await call(running, 'GET', '/fs/file/home/user/hello.txt', null, {range: 'bytes=-2'});
    assert.deepStrictEqual([tail.status, tail.body], [206, 'ld']);
    const past = await call(running, 'GET', '/fs/file/home/user/hello.txt', null, {range: 'bytes=99-'});
    assert.deepStrictEqual([past.status, past.headers['content-range']], [416, 'bytes */11']);
    const empty = await call(running, 'GET', '/fs/file/home/user/empty.txt');
    assert.deepStrictEqual([empty.status, empty.body], [200, '']);
    const folder = await call(running, 'GET', '/fs/file/home/user/inner');
    assert.strictEqual(folder.status, 400, 'a folder comes as a tar');
    const missing = await call(running, 'GET', '/fs/file/home/user/nothing.txt');
    assert.deepStrictEqual([missing.status, JSON.parse(missing.body).error], [502, 'ENOENT: /home/user/nothing.txt']);

    // Several names as one download, saved under the folder's name, or the host's for the root
    const tar = await call(running, 'GET', '/fs/tar?dir=/home/user&names=inner&names=hello.txt');
    assert.deepStrictEqual([tar.status, tar.body], [200, 'tar of /home/user: inner hello.txt']);
    assert.match(tar.headers['content-disposition'], /^attachment; filename="user\.tar"/);
    const root_tar = await call(running, 'HEAD', '/fs/tar?dir=/&names=home');
    assert.match(root_tar.headers['content-disposition'], /^attachment; filename="box\.tar"/);
    const refused_tar = await call(running, 'GET', '/fs/tar?dir=/home/user');
    assert.deepStrictEqual([refused_tar.status, JSON.parse(refused_tar.body).error], [502, 'nothing is named to take']);

    // A file in, under a name of its own and nothing that walks out of its folder
    const landed = await call(running, 'POST', '/fs/upload?dir=/home/user&name=new.txt', 'new text');
    assert.deepStrictEqual([landed.status, JSON.parse(landed.body)], [200, {path: '/home/user/new.txt', bytes: 8, replaced: false}]);
    assert.strictEqual((await call(running, 'GET', '/fs/file/home/user/new.txt')).body, 'new text');
    const walked = await call(running, 'POST', `/fs/upload?dir=/home/user&name=${encodeURIComponent('../x')}`, 'x');
    assert.strictEqual(walked.status, 400);
    const nowhere = await call(running, 'POST', '/fs/upload?name=x.txt', 'x');
    assert.deepStrictEqual([nowhere.status, JSON.parse(nowhere.body).error], [400, 'a folder is required']);

    // A folder made, a name carried to another, a name taken away; a body that is not json
    assert.strictEqual((await call(running, 'POST', '/fs/mkdir', JSON.stringify({path: '/home/user/made/deep'}))).status, 200);
    assert.strictEqual((await call(running, 'POST', '/fs/rename', JSON.stringify({from: '/home/user/new.txt', to: '/home/user/made/new.txt'}))).status, 200);
    // A name that is taken is the disk's refusal, in its words: a file is not replaced, and
    // nothing is moved into a folder
    for (const [to, name] of [['/home/user/page.html', 'page.html'], ['/home/user/inner', 'inner']]) {
        const taken = await call(running, 'POST', '/fs/rename', JSON.stringify({from: '/home/user/empty.txt', to}));
        assert.deepStrictEqual([taken.status, JSON.parse(taken.body)], [502, {error: `${name} is there already`}]);
    }
    assert.deepStrictEqual([disk.files['/home/user/empty.txt'], disk.files['/home/user/page.html'], disk.files['/home/user/inner/deep.txt']], ['', '<p>a page</p>', 'deep']);
    assert.strictEqual((await call(running, 'POST', '/fs/delete', JSON.stringify({path: '/home/user/hello.txt'}))).status, 200);
    assert.deepStrictEqual(Object.keys(disk.files).sort(), ['/home/user/empty.txt', '/home/user/inner/deep.txt', '/home/user/made/deep/', '/home/user/made/new.txt', '/home/user/page.html', '/home/user/привет.txt']);
    assert.strictEqual((await call(running, 'POST', '/fs/rename', 'not json')).status, 400);

    // An address under the base that is no door, or a door asked the wrong way
    const nothing = await call(running, 'GET', '/fs/nothing');
    assert.deepStrictEqual([nothing.status, JSON.parse(nothing.body).error], [404, 'no such door: /fs/nothing']);
    assert.strictEqual((await call(running, 'POST', '/fs')).status, 404);

    // What was done, for the host's log
    assert.deepStrictEqual(logged.map(v => v[0]), ['file_read', 'file_read', 'file_read', 'file_read', 'file_read', 'file_read', 'file_read', 'file_copied', 'file_read', 'fs_folder_made', 'fs_renamed', 'fs_deleted']);
    assert.deepStrictEqual(logged[7][1], {path: '/home/user/new.txt', bytes: 8});
});

// A file's path is the address's own tail, percent-encoded, and percent signs that spell no
// text are the asker's mistake: a 400 that says so. Thrown instead, it was the host's to catch:
// a host that did not stopped, and one that did answered as if the fault were its own.
test('a file\'s path whose percent signs spell no text is a 400 that says so, and the door goes on answering', async function (t) {
    // A request left with no answer would hold its server open, and this file with it
    t.after(() => http.globalAgent.destroy());
    const running = await serve(t, {disk: disk_in_memory({'/home/user/hello.txt': 'hello world'})});
    for (const tail of ['/home/user/%E0%A4%A', '/home/user/100%.txt', '/%zz']) {
        const refused = await call(running, 'GET', `/fs/file${tail}`);
        assert.deepStrictEqual([refused.status, JSON.parse(refused.body)], [400, {error: `a file's path is percent-encoded UTF-8, and ${JSON.stringify(tail)} is not that`}]);
        assert.strictEqual((await call(running, 'HEAD', `/fs/file${tail}`)).status, 400, tail);
    }

    // And the door goes on answering
    assert.strictEqual((await call(running, 'GET', '/fs/file/home/user/hello.txt')).body, 'hello world');
});

test('a file in parts: how much is in, a part sent again, a finish only when whole, a cancel', async function (t) {
    const disk = disk_in_memory({'/home/user/old.txt': 'x'});
    const running = await serve(t, {disk});
    function at(more) {
        return `dir=/home/user&name=film.bin&id=u1abcdef9${more}`;
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
    assert.deepStrictEqual(JSON.parse(done.body), {path: '/home/user/film.bin', bytes: 4, replaced: false});
    assert.strictEqual(disk.files['/home/user/film.bin'], 'aBCD');

    await call(running, 'POST', '/fs/upload/part?dir=/home/user&name=gone.bin&id=u2abcdef9&offset=0', 'xyz');
    assert.strictEqual((await call(running, 'POST', '/fs/upload/cancel?dir=/home/user&name=gone.bin&id=u2abcdef9')).status, 200);
    assert.deepStrictEqual(disk.parts, {});

    // An id that is not letters and digits, a name that walks out, no folder
    assert.strictEqual((await call(running, 'GET', '/fs/upload/part?dir=/home/user&name=x&id=../x')).status, 400);
    assert.strictEqual((await call(running, 'GET', `/fs/upload/part?dir=/home/user&name=${encodeURIComponent('../x')}&id=u3abcdef9`)).status, 400);
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
    const queue = transfer_queue({disk_of: disks_of({a, b}), log: (event_name, fields) => logged.push([event_name, fields]), part_bytes: 10, small_bytes: 20});

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
    assert.deepStrictEqual(b.tars, ['/b/proj', '/b/proj'], 'each tar is written into the folder the copy makes');
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
    const queue_old = transfer_queue({disk_of: disks_of({a, c}), part_bytes: 10});
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
    const queue = transfer_queue({disk_of: disks_of({a, b}), part_bytes: 10, small_bytes: 20});
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
    assert.deepStrictEqual(Array.from(labels).filter(v => v.startsWith('set/')), ['set/one.txt 3', 'set/two.bin 30']);
    assert.ok(Array.from(labels).every(v => v.includes('in one go') === false), Array.from(labels).join(' | '));
});

// The small files of a folder go as one tar, and the line under the copy names each of them as
// it goes, read from the tar's own headers: the file, its size and how far it is
test('a tar of small files names each file as it goes, from its own headers', async function () {
    const a = disk_that_copies_folders({'/a/set/one.txt': 'one', '/a/set/deep/two.txt': 'two!', '/a/set/three.txt': 'three'});
    const b = disk_that_copies_folders({});
    // A slow link: the tar comes a block at a time
    const tar = a.tar;
    a.tar = function (dir, names, options) {
        const original = tar(dir, names, options);
        return stream.Readable.from((async function* () {
            const whole = await bytes_of(original);
            for (let at = 0; at < whole.length; at += 512) {
                await new Promise(v => setTimeout(v, 40));
                yield whole.subarray(at, at + 512);
            }
        })());
    };
    const queue = transfer_queue({disk_of: disks_of({a, b}), small_bytes: 20});
    const folder = queue.add({disk: 'a', path: '/a/set'}, {disk: 'b', dir: '/b'});
    const seen = [];
    await until(function () {
        const now = folder.now;
        if ((now !== null) && ((seen.length === 0) || (seen[seen.length - 1] !== `${now.label} ${now.size}`))) {
            seen.push(`${now.label} ${now.size}`);
        }
        return folder.phase === 'ok';
    }, 10000);
    assert.deepStrictEqual(seen, ['set/deep/two.txt 4', 'set/one.txt 3', 'set/three.txt 5']);
    assert.deepStrictEqual(folder.now, {label: 'set/three.txt', size: 5, done: 5});
    assert.strictEqual(b.files['/b/set/deep/two.txt'], 'two!');
});

// A link that stays up and carries nothing never fails by itself. A step whose bytes stand
// still is cut, says so, and goes on from where it stood: a tar again whole, a part from where
// the disk says the file is; a disk still taking what it was sent is not cut.
test('a copy whose bytes stand still is cut and goes on by itself; one still being taken is not', async function () {
    const a = disk_that_copies_folders({'/a/set/one.txt': 'one', '/a/set/two.txt': 'two', '/a/film.bin': 'f'.repeat(50)});
    const b = disk_that_copies_folders({});
    const logged = [];
    const queue = transfer_queue({disk_of: disks_of({a, b}), log: (event_name, fields) => logged.push([event_name, fields]), part_bytes: 20, small_bytes: 10, stall_ms: 300});
    // The first tar sends its first block and then nothing, as the link did
    const tar = a.tar;
    let tars = 0;
    a.tar = function (dir, names, options) {
        tars++;
        const original = tar(dir, names, options);
        if (tars > 1) {
            return original;
        }
        const out = new stream.Readable({read: function () {}});
        bytes_of(original).then(v => out.push(v.subarray(0, 512)));
        return out;
    };
    const folder = queue.add({disk: 'a', path: '/a/set'}, {disk: 'b', dir: '/b'});
    const said = [];
    await until(function () {
        if (folder.phase === 'retrying') {
            said.push(folder.said);
        }
        return folder.phase === 'ok';
    }, 10000);
    assert.match(said[0], /^nothing moved for \d+s$/);
    assert.deepStrictEqual([tars, b.tars], [2, ['/b/set', '/b/set']], 'the tar went again whole, not file by file');
    assert.strictEqual(b.files['/b/set/two.txt'], 'two');
    const stalled = logged.filter(v => v[0] === 'transfer_stalled');
    assert.deepStrictEqual(stalled.map(v => [v[1].step, v[1].read, v[1].taken]), [['tar', 512, 0]]);

    // The second part of a file is held by a disk that takes nothing and says nothing
    const write = b.part_write;
    let parts = 0;
    b.part_write = function (dir, name, id, offset, source, taken) {
        parts++;
        if (parts === 2) {
            return new Promise((resolve, reject) => source.on('error', reject));
        }
        return write(dir, name, id, offset, source, taken);
    };
    const film = queue.add({disk: 'a', path: '/a/film.bin'}, {disk: 'b', dir: '/b'});
    await until(() => film.phase === 'ok', 10000);
    assert.strictEqual(b.files['/b/film.bin'], 'f'.repeat(50));
    assert.deepStrictEqual(logged.filter(v => v[0] === 'transfer_stalled').map(v => v[1].step), ['tar', 'part']);

    // A disk that takes a part slowly, a few bytes at a time, past the stall's time: not cut
    b.part_write = async function (dir, name, id, offset, source, taken) {
        for (let i = 0; i < 8; i++) {
            await new Promise(v => setTimeout(v, 100));
            taken(1);
        }
        return await write(dir, name, id, offset, source, taken);
    };
    const slow = queue.add({disk: 'a', path: '/a/set/one.txt'}, {disk: 'b', dir: '/s'});
    await until(() => slow.phase === 'ok', 10000);
    assert.strictEqual(b.files['/s/one.txt'], 'one');
    assert.strictEqual(logged.filter(v => v[0] === 'transfer_stalled').length, 2, 'a disk still taking bytes is not cut');
});

// Copies between machines are drawn as Uploads is: every copy in line counted at once, and
// Pause and Resume for all of them
test('a copy is weighed as soon as it is asked for; Pause stops the one under way where it stands, Resume carries it on', async function () {
    const film = 'f'.repeat(60);
    const a = disk_that_copies_folders({'/a/film.bin': film, '/a/set/one.txt': 'one', '/a/set/two.bin': 't'.repeat(30)});
    const b = disk_that_copies_folders({});
    const logged = [];
    const queue = transfer_queue({disk_of: disks_of({a, b}), log: v => logged.push(v), part_bytes: 10, small_bytes: 20});
    // A slow link, and a part that waits on it until it lands or is cut
    const write = b.part_write;
    let parts = 0;
    b.part_write = async function (dir, name, id, offset, source) {
        await new Promise(function (resolve, reject) {
            setTimeout(resolve, 150);
            source.on('error', reject);
        });
        parts++;
        return await write(dir, name, id, offset, source);
    };
    const first = queue.add({disk: 'a', path: '/a/film.bin'}, {disk: 'b', dir: '/b'});
    const second = queue.add({disk: 'a', path: '/a/set'}, {disk: 'b', dir: '/b'});
    await until(() => second.size !== null);
    assert.strictEqual(first.phase, 'copying');
    assert.deepStrictEqual([second.phase, second.kind, second.files, second.size], ['waiting', 'dir', 2, 33], 'the folder in line is counted while the file goes');

    await until(() => first.received >= 20, 10000);
    queue.pause();
    assert.strictEqual(queue.paused, true);
    await until(() => first.phase === 'paused');
    const parts_paused = parts;
    await new Promise(v => setTimeout(v, 600));
    assert.deepStrictEqual([first.phase, second.phase, parts], ['paused', 'waiting', parts_paused], 'nothing goes while paused');
    assert.strictEqual(b.files['/b/film.bin'], undefined);

    queue.resume();
    assert.strictEqual(queue.paused, false);
    await until(() => (second.phase === 'ok') || (second.phase === 'error'), 10000);
    assert.deepStrictEqual([first.phase, second.phase], ['ok', 'ok']);
    assert.strictEqual(b.files['/b/film.bin'], film, 'carried on from where the disk said it stood');
    assert.strictEqual(b.files['/b/set/two.bin'], 't'.repeat(30));
    assert.deepStrictEqual(b.parts, {});
    assert.ok(first.paused_ms >= 600, `the pause is kept apart from its run: ${first.paused_ms}`);
    assert.deepStrictEqual(logged.filter(v => v.startsWith('transfer_') && (v !== 'transfer_begin') && (v !== 'transfer_end_ok')), ['transfer_paused', 'transfer_resumed']);

    // A paused copy given up ends, and the next one asked for starts rather than waiting paused
    const third = queue.add({disk: 'a', path: '/a/film.bin'}, {disk: 'b', dir: '/c'});
    await until(() => third.received > 0, 10000);
    queue.pause();
    await until(() => third.phase === 'paused');
    queue.cancel(third.id);
    await until(() => third.phase === 'cancelled');
    assert.strictEqual(queue.paused, false);
    const fourth = queue.add({disk: 'a', path: '/a/set/one.txt'}, {disk: 'b', dir: '/d'});
    await until(() => fourth.phase === 'ok', 10000);
    assert.strictEqual(b.files['/d/one.txt'], 'one');

    // Nothing under way is nothing to pause
    queue.pause();
    assert.strictEqual(queue.paused, false);
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
    assert.strictEqual(JSON.parse((await call(running, 'GET', '/transfers')).body).paused, false);
    assert.deepStrictEqual(JSON.parse((await call(running, 'POST', '/transfers/pause')).body), {paused: false}, 'nothing under way, nothing paused');
    assert.deepStrictEqual(JSON.parse((await call(running, 'POST', '/transfers/resume')).body), {paused: false});
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
                {type: 'start', path: '/home/user'},
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
    const listed = await call(running, 'GET', '/fs?path=/home/user&tree=1&hash=sha256&skip=.git,node_modules&skip=dist');
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
    assert.deepStrictEqual(asked[0], ['/home/user', {hash: true, skip: ['.git', 'node_modules', 'dist']}]);
    await until(() => logged.length > 0);
    assert.deepStrictEqual([logged[0][0], logged[0][1].names, logged[0][1].hashed], ['tree_listed', 7, 1]);

    // The same walk as events: one plain data line an object, the very objects of the JSON
    const events = await call(running, 'GET', '/fs?path=/home/user&tree=1&hash=sha256', null, {accept: 'text/event-stream'});
    assert.deepStrictEqual([events.status, events.headers['content-type']], [200, 'text/event-stream; charset=utf-8']);
    const blocks = events.body.split('\n\n').filter(v => v !== '');
    assert.strictEqual(blocks.every(v => v.startsWith('data: {')), true, 'no event names, nothing but data');
    assert.deepStrictEqual(blocks.map(v => v.slice(6)).sort(), JSON.parse(listed.body).map(v => JSON.stringify(v)).sort());
    assert.strictEqual(blocks.at(-1), 'data: {"type":"end"}');
    assert.deepStrictEqual(asked[1], ['/home/user', {hash: true, skip: []}]);

    // A walk that stops before its end: a 502 before anything is sent; under way, an error
    // object with no path and no end
    const cut = await call(running, 'GET', '/fs?path=/cut&tree=1');
    assert.deepStrictEqual([cut.status, JSON.parse(cut.body).error], [502, 'the disk stopped before the whole tree was read']);
    const cut_events = await call(running, 'GET', '/fs?path=/cut&tree=1', null, {accept: 'text/event-stream'});
    assert.deepStrictEqual([cut_events.status, cut_events.body.split('\n\n').filter(v => v !== '').at(-1)], [200, 'data: {"type":"error","error":"the disk stopped before the whole tree was read"}']);

    // A folder that cannot be read is an error before anything is answered, in both forms
    assert.deepStrictEqual(JSON.parse((await call(running, 'GET', '/fs?path=/nothing&tree=1')).body), {error: 'ENOENT: /nothing'});
    assert.strictEqual((await call(running, 'GET', '/fs?path=/nothing&tree=1', null, {accept: 'text/event-stream'})).status, 502);

    assert.strictEqual((await call(running, 'GET', '/fs?path=/home/user&tree=1&hash=md5')).status, 400);

    // A delay spaces events out, and holds the walk meanwhile; it is for events alone
    const time0 = Date.now();
    const slow = await call(running, 'GET', '/fs?path=/home/user&tree=1&delay=60', null, {accept: 'text/event-stream'});
    assert.ok(Date.now() - time0 >= 420, 'seven names, a delay after each');
    assert.strictEqual((slow.body.match(/^data: /gm) || []).length, 8);
    for (const bad of ['delay=-1', 'delay=1001', 'delay=soon', 'delay=1.5']) {
        assert.strictEqual((await call(running, 'GET', `/fs?path=/home/user&tree=1&${bad}`, null, {accept: 'text/event-stream'})).status, 400, bad);
    }
    assert.match(JSON.parse((await call(running, 'GET', '/fs?path=/home/user&tree=1&delay=10')).body).error, /spaces events out/);

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

    const plain = await serve(t, {disk: disk_in_memory({'/home/user/a.txt': 'a'})});
    assert.strictEqual((await call(plain, 'GET', '/fs?path=/home/user&tree=1')).status, 501);
    assert.strictEqual(JSON.parse((await call(plain, 'GET', '/fs?path=/home/user')).body).items.length, 1, 'without tree the list is as it was');
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
    const request = http.request({host: '127.0.0.1', port: running.port, path: '/fs/watch?path=/home/user&tree=1&skip=node_modules&skip=.git'}, function (answer) {
        status = [answer.statusCode, answer.headers['content-type']];
        answer.on('data', v => events.push(...v.toString('utf8').split('\n\n').filter(vv => vv !== '')));
    });
    request.end();
    await until(() => opened.length === 1);
    assert.deepStrictEqual(opened[0].asked, {dir: '/home/user', options: {tree: true, skip: ['node_modules', '.git']}});
    assert.strictEqual(status, null, 'nothing is answered before the watch holds');
    opened[0].write('{"type":"ready","path":"/home/user"}\n{"type":"created","path":"a.txt","kind":"file","size":1,"mtime_ms":5}\n{"type":"res');
    opened[0].write('ync","why":"lost"}\n');
    await until(() => events.length === 3);
    assert.deepStrictEqual(status, [200, 'text/event-stream; charset=utf-8']);
    assert.deepStrictEqual(events, [
        'event: ready\ndata: {"type":"ready","path":"/home/user"}',
        'event: created\ndata: {"type":"created","path":"a.txt","kind":"file","size":1,"mtime_ms":5}',
        'event: resync\ndata: {"type":"resync","why":"lost"}',
    ]);

    // The page goes: the disk's watch is closed, and the host hears how long it ran
    request.destroy();
    await until(() => opened[0].destroyed);
    await until(() => logged.length === 1);
    assert.deepStrictEqual([logged[0][0], logged[0][1].path, logged[0][1].tree, logged[0][1].events], ['folder_watched', '/home/user', true, 2]);

    // A folder that cannot be watched is an error, not an empty stream
    const refused = call(running, 'GET', '/fs/watch?path=/nothing');
    await until(() => opened.length === 2);
    opened[1].destroy(new Error('ENOENT: /nothing'));
    assert.deepStrictEqual([(await refused).status, JSON.parse((await refused).body).error], [502, 'ENOENT: /nothing']);

    // One that fails after it held says so as an event, and ends
    const failed = call(running, 'GET', '/fs/watch?path=/home/user');
    await until(() => opened.length === 3);
    opened[2].write('{"type":"ready","path":"/home/user"}\n');
    await timers.setTimeout(50);
    opened[2].destroy(new Error('/home/user is gone'));
    assert.strictEqual((await failed).body, 'event: ready\ndata: {"type":"ready","path":"/home/user"}\n\nevent: error\ndata: {"error":"/home/user is gone"}\n\n');

    // A disk that cannot watch
    const plain = await serve(t, {disk: disk_in_memory({})});
    assert.strictEqual((await call(plain, 'GET', '/fs/watch?path=/')).status, 501);
});

// A disk is a machine's agent as often as not, and a line it says is its own word: one that is
// no JSON object ends the tree, the watch or the copy with that reason. Read with a bare
// JSON.parse inside the stream's listener, where nothing catches, it ended the process.
test('a line of the disk that is no JSON object fails the tree, the watch and the copy, and nothing else', async function (t) {
    const refusal = 'the disk said a line that is no JSON object';
    // A request left with no answer would hold its server open, and this file with it
    t.after(() => http.globalAgent.destroy());
    for (const line of ['this is not json', 'null', '7']) {
        const opened = [];
        const disk = disk_that_copies_folders({'/a/proj/x.txt': 'x'});
        disk.tree = function () {
            return said_in_turns(['{"type":"start","path":"/home/user"}\n', `${line}\n`]);
        };
        disk.watch = function () {
            const out = new stream.PassThrough();
            opened.push(out);
            return out;
        };
        const running = await serve(t, {disk});

        // A tree: a 502 as one JSON; as events, already under way, an error event and the end
        const listed = await call(running, 'GET', '/fs?path=/home/user&tree=1');
        assert.deepStrictEqual([listed.status, JSON.parse(listed.body)], [502, {error: refusal}], line);
        const events = await call(running, 'GET', '/fs?path=/home/user&tree=1', null, {accept: 'text/event-stream'});
        assert.deepStrictEqual([events.status, events.body], [200, `data: {"type":"error","error":"${refusal}"}\n\n`], line);

        // A watch: a 502 before it held, an error event once it did
        const refused = call(running, 'GET', '/fs/watch?path=/home/user');
        await until(() => opened.length === 1);
        opened[0].write(`${line}\n`);
        assert.deepStrictEqual([(await refused).status, JSON.parse((await refused).body)], [502, {error: refusal}], line);
        const failed = call(running, 'GET', '/fs/watch?path=/home/user');
        await until(() => opened.length === 2);
        opened[1].write(`{"type":"ready","path":"/home/user"}\n${line}\n`);
        assert.strictEqual((await failed).body, `event: ready\ndata: {"type":"ready","path":"/home/user"}\n\nevent: error\ndata: {"error":"${refusal}"}\n\n`, line);

        // A folder's copy: its walk fails as a link that dropped does, the copy says why and
        // waits to try again
        const to = disk_that_copies_folders({});
        const queue = transfer_queue({disk_of: disks_of({a: disk, b: to})});
        const item = queue.add({disk: 'a', path: '/a/proj/'}, {disk: 'b', dir: '/b'});
        await until(() => item.phase !== 'copying');
        assert.deepStrictEqual([item.phase, item.said], ['retrying', refusal], line);
        queue.cancel(item.id);
        await until(() => item.phase === 'cancelled');

        // And the door goes on answering
        assert.strictEqual((await call(running, 'GET', '/fs?path=/a/proj')).status, 200, line);
    }
});

// A walk is the word of the disk a folder is copied from, and that disk may be a machine whose
// agent lies. The copy makes, writes and links under every path of the walk on the other disk:
// taken as it came, a file named ../../.ssh/authorized_keys landed outside the folder the copy
// went into, on a machine that had said nothing.
test('a walk that names a path outside its folder fails the copy for good, before anything is written; a name that only looks like one still copies', async function () {
    const key = 'a key of the attacker\n';
    function refusal_of(named) {
        return `laptop walked the folder and named ${named}, which is no path under it: nothing was copied`;
    }
    // One copy of laptop's /srv/photos into desktop's /home/user/incoming, until it stops
    async function copy_run(from, to, logged) {
        const queue = transfer_queue({disk_of: disks_of({laptop: from, desktop: to}), log: (event_name, fields) => logged.push([event_name, fields]), part_bytes: 10, small_bytes: 20});
        const item = queue.add({disk: 'laptop', path: '/srv/photos'}, {disk: 'desktop', dir: '/home/user/incoming'});
        await until(() => item.phase !== 'copying');
        return item;
    }

    // A file, a folder and a link, each two folders above the one walked: none is made, the
    // copy is an error that names the machine and the path, and it is not tried again
    const lying = disk_that_walks([
        {type: 'file', path: '../../.ssh/authorized_keys', size: key.length, mtime_ms: 0, mode: 0o600},
        {type: 'dir', path: '../../cron.d', size: null, mtime_ms: 0},
        {type: 'link', path: '../../.bashrc', size: null, mtime_ms: 0, target: '/tmp/evil'},
    ]);
    lying.files['/.ssh/authorized_keys'] = key;
    const desktop = disk_that_copies_folders({'/home/user/incoming/keep.txt': 'kept'});
    const logged = [];
    const refused = await copy_run(lying, desktop, logged);
    assert.deepStrictEqual({phase: refused.phase, said: refused.said, files: desktop.files, links: desktop.links, parts: desktop.parts}, {
        phase: 'error',
        said: refusal_of('"../../.ssh/authorized_keys"'),
        files: {'/home/user/incoming/keep.txt': 'kept'},
        links: {},
        parts: {},
    });
    assert.deepStrictEqual(logged.map(v => v[0]), ['transfer_begin', 'transfer_end_error']);
    assert.deepStrictEqual(logged[1][1], {id: refused.id, reason: refused.said});
    assert.deepStrictEqual([refused.size, refused.files, refused.wait_s], [null, null, 0], 'not weighed, and not waiting to try again');

    // Every kind of line the walk takes, and every way a path is no path under the folder: a
    // root, `..` anywhere, a `.` or an empty part, no text at all. A path too long to say is cut.
    const long = `../${'a'.repeat(5000)}`;
    const wrong = [
        [{type: 'file', path: '/etc/passwd', size: 1, mode: 0o644}, '"/etc/passwd"'],
        [{type: 'file', path: 'a/../../b', size: 1, mode: 0o644}, '"a/../../b"'],
        [{type: 'file', path: 'a/..', size: 1, mode: 0o644}, '"a/.."'],
        [{type: 'file', path: './a', size: 1, mode: 0o644}, '"./a"'],
        [{type: 'file', path: 'a//b', size: 1, mode: 0o644}, '"a//b"'],
        [{type: 'file', path: 'a/', size: 1, mode: 0o644}, '"a/"'],
        [{type: 'file', path: '', size: 1, mode: 0o644}, '""'],
        [{type: 'file', size: 1, mode: 0o644}, 'undefined'],
        [{type: 'file', path: null, size: 1, mode: 0o644}, 'null'],
        [{type: 'file', path: 7, size: 1, mode: 0o644}, '7'],
        [{type: 'file', path: ['..', 'b'], size: 1, mode: 0o644}, '["..","b"]'],
        [{type: 'file', path: long, size: 1, mode: 0o644}, `${JSON.stringify(long).slice(0, 200)}…`],
        [{type: 'dir', path: '..'}, '".."'],
        [{type: 'link', path: '../lib', target: 'src'}, '"../lib"'],
        [{type: 'other', path: '../sock'}, '"../sock"'],
        [{type: 'error', path: '../x', error: 'EACCES: permission denied'}, '"../x"'],
        [{type: 'error', error: 'EACCES: permission denied'}, 'undefined'],
    ];
    for (const [line, named] of wrong) {
        const to = disk_that_copies_folders({});
        const item = await copy_run(disk_that_walks([{type: 'file', path: 'a.jpg', size: 1, mode: 0o644}, line]), to, []);
        assert.deepStrictEqual([item.phase, item.said, to.files, to.links, to.parts], ['error', refusal_of(named), {}, {}, {}], JSON.stringify(line).slice(0, 80));
    }

    // Names that only look like it are names, in tars of many and each alone: dots, dashes,
    // spaces, any letters, any depth. A link is made with the text it had, wherever it points.
    const names = {
        '/srv/photos/.env': 'A=1',
        '/srv/photos/-rf': 'a name like an option',
        '/srv/photos/..hidden': 'two dots first',
        '/srv/photos/a..b': 'two dots inside',
        '/srv/photos/...': 'three dots',
        '/srv/photos/.. ': 'two dots and a space',
        '/srv/photos/with space.txt': 'a space',
        '/srv/photos/ünï/日本.txt': 'any letters',
        '/srv/photos/deep/a/b/c/d/e.txt': 'deep',
        '/srv/photos/empty dir/': '',
    };
    const landed = Object.fromEntries(Object.entries(names).map(v => [v[0].replace('/srv/', '/home/user/incoming/'), v[1]]));
    landed['/home/user/incoming/photos/'] = '';
    for (const tars of [true, false]) {
        const from = disk_that_copies_folders(names);
        from.links['/srv/photos/up'] = '../shared';
        from.links['/srv/photos/abs'] = '/etc/hosts';
        from.can = function () {
            return tars;
        };
        const to = disk_that_copies_folders({});
        const item = await copy_run(from, to, []);
        assert.deepStrictEqual([item.phase, item.said, item.files_done], ['ok', '', 9], `tars: ${tars}`);
        assert.deepStrictEqual(to.files, landed, `tars: ${tars}`);
        assert.deepStrictEqual(to.links, {'/home/user/incoming/photos/up': '../shared', '/home/user/incoming/photos/abs': '/etc/hosts'}, `tars: ${tars}`);
        assert.strictEqual(to.tars.length > 0, tars);
    }

    // The folder itself, the empty path, is what an error names when the folder cannot be read:
    // said as before, with the copy. A line of a kind the walk does not take names nothing.
    const closed = await copy_run(disk_that_walks([{type: 'error', path: '', error: 'EACCES: permission denied'}, {type: 'note', path: '../x'}]), disk_that_copies_folders({}), []);
    assert.deepStrictEqual([closed.phase, closed.said, closed.left.names], ['ok', '1 name could not be copied', [{path: '', said: 'EACCES: permission denied'}]]);
});

// A folder's copy makes one folder, <dir>/<its name>, and the disk it comes from says every
// name that goes into it, the names inside its tars among them. A tar was written into <dir>,
// so a sibling.txt in it landed beside the folder: copied into a home, a key under .ssh.
test('a tar of a folder\'s copy is of the folder itself and is written into the folder the copy makes: a name the tar carries lands inside it, never beside it', async function () {
    const key = 'a key of the attacker\n';
    // A tar with a file for beside the folder and a key for the home, from a disk whose walk
    // said a.jpg alone: both land inside the folder
    for (const dir of ['/home/user/incoming', '/home/user']) {
        const tars_asked = [];
        const home = disk_that_copies_folders({[`${dir}/keep.txt`]: 'kept'});
        const queue = transfer_queue({disk_of: disks_of({laptop: disk_that_tars([{name: 'sibling.txt', text: 'beside'}, {name: '.ssh/authorized_keys', text: key}], tars_asked), desktop: home}), small_bytes: 20});
        const beside = queue.add({disk: 'laptop', path: '/srv/photos'}, {disk: 'desktop', dir});
        await until(() => beside.phase !== 'copying');
        assert.deepStrictEqual([beside.phase, beside.said], ['ok', ''], dir);
        assert.deepStrictEqual(home.files, {
            [`${dir}/keep.txt`]: 'kept',
            [`${dir}/photos/`]: '',
            [`${dir}/photos/sibling.txt`]: 'beside',
            [`${dir}/photos/.ssh/authorized_keys`]: key,
        }, dir);
        assert.deepStrictEqual([tars_asked, home.tars], [[['/srv/photos', ['a.jpg']]], [`${dir}/photos`]], dir);
    }
});

// The disk a folder comes from says every name of its copy, and its folder may change between
// two copies. A link one copy made was written through by the next: lib/evil.txt is a path
// under the folder, as far as its name goes, and lib led out of it.
test('a folder\'s copy is written through a disk kept within the folder it makes: a name that leads out of it through a link there, one a copy before made or the owner, ends the copy', async function () {
    const key = 'a key of the attacker\n';
    const outside = '/home/user/outside';
    function refusal_of(rel) {
        return `a link on desktop leads out of photos, the folder being copied: ${JSON.stringify(`/home/user/incoming/photos/${rel}`)} lies outside it, and the copy stopped`;
    }
    // One copy of laptop's /srv/photos into desktop's /home/user/incoming, until it stops
    async function copy_run(from, to, logged) {
        const queue = transfer_queue({disk_of: disks_of({laptop: from, desktop: to}), log: (event_name, fields) => logged.push([event_name, fields]), part_bytes: 10, small_bytes: 20});
        const item = queue.add({disk: 'laptop', path: '/srv/photos'}, {disk: 'desktop', dir: '/home/user/incoming'});
        await until(() => item.phase !== 'copying');
        return item;
    }

    // Two copies of the same folder into the same place. The first walk names a link that
    // points out of the folder, as a link may, and it is made. The second names a file under
    // that link's name: it is not written, there or anywhere, and the copy is an error that
    // names it, once.
    const desktop = disk_that_copies_folders({'/home/user/incoming/keep.txt': 'kept'});
    const first = await copy_run(disk_that_walks([{type: 'link', path: 'lib', size: null, mtime_ms: 0, target: outside}]), desktop, []);
    assert.deepStrictEqual([first.phase, first.said, desktop.links], ['ok', '', {'/home/user/incoming/photos/lib': outside}]);
    const second_from = disk_that_walks([{type: 'file', path: 'lib/evil.txt', size: 4, mtime_ms: 0, mode: 0o644}]);
    second_from.files['/srv/photos/lib/evil.txt'] = 'evil';
    const logged = [];
    const second = await copy_run(second_from, desktop, logged);
    assert.deepStrictEqual({phase: second.phase, said: second.said, files: desktop.files, parts: desktop.parts}, {
        phase: 'error',
        said: refusal_of('lib/evil.txt'),
        files: {'/home/user/incoming/keep.txt': 'kept', '/home/user/incoming/photos/': ''},
        parts: {},
    });
    assert.deepStrictEqual(logged.map(v => v[0]), ['transfer_begin', 'transfer_end_error']);
    assert.deepStrictEqual([logged[1][1], second.wait_s], [{id: second.id, reason: second.said}, 0], 'said once, and not waiting to try again');

    // The same file in a tar of many, from a disk that does not lie at all: the tar is refused
    // at that name, and the copy ends at once with the path as the disk named it. What came
    // before it in the tar stays.
    const honest = disk_that_copies_folders({'/srv/photos/a.jpg': 'a', '/srv/photos/lib/evil.txt': 'evil'});
    const tarred_logged = [];
    const tarred = await copy_run(honest, desktop, tarred_logged);
    assert.deepStrictEqual([tarred.phase, tarred.said, tarred.wait_s, desktop.tars], ['error', refusal_of('lib/evil.txt'), 0, ['/home/user/incoming/photos']]);
    assert.deepStrictEqual(tarred_logged.map(v => v[0]), ['transfer_begin', 'transfer_end_error']);
    assert.deepStrictEqual([desktop.files, desktop.parts], [{'/home/user/incoming/keep.txt': 'kept', '/home/user/incoming/photos/': '', '/home/user/incoming/photos/a.jpg': 'a'}, {}]);

    // A tar that lies, and a link planted under one of its names: the walk said a.jpg alone,
    // the tar carries a file under the link, and the copy ends naming what the tar named
    const lied = await copy_run(disk_that_tars([{name: 'a.jpg', text: 'a'}, {name: 'lib/key.txt', text: key}], []), desktop, []);
    assert.deepStrictEqual([lied.phase, lied.said], ['error', refusal_of('lib/key.txt')]);
    assert.deepStrictEqual(Object.keys(desktop.files).filter(v => v.startsWith('/home/user/incoming/') === false), [], 'nothing outside the folder copied into');

    // A link under a file's own name, to a file outside, and a link the owner made on purpose,
    // node_modules to a cache outside the folder: neither is written through, in a tar or
    // file by file, and the copy says which path it stopped at
    for (const [link, target, file] of [['notes.txt', '/home/user/.bashrc', 'notes.txt'], ['node_modules', '/opt/cache', 'node_modules/m.js']]) {
        for (const tars of [true, false]) {
            const profile = disk_that_copies_folders({'/home/user/.bashrc': 'the owner\'s', '/opt/cache/kept.js': 'kept'});
            profile.links[`/home/user/incoming/photos/${link}`] = target;
            const from = disk_that_copies_folders({[`/srv/photos/${file}`]: 'evil'});
            from.can = function () {
                return tars;
            };
            const item = await copy_run(from, profile, []);
            assert.deepStrictEqual([item.phase, item.said], ['error', refusal_of(file)], `${file}, tars: ${tars}`);
            assert.deepStrictEqual(profile.files, {'/home/user/.bashrc': 'the owner\'s', '/opt/cache/kept.js': 'kept', '/home/user/incoming/photos/': ''}, `${file}, tars: ${tars}`);
        }
    }

    // One walk, one copy: a link that points out is there, and the walk names a link or an
    // empty folder under its name. Neither is made, and the copy stops at it. So does a walk
    // that names both links itself: the first is made, as a link may be, the second is not.
    for (const [line, rel] of [
        [{type: 'link', path: 'lib/key', size: null, mtime_ms: 0, target: '/tmp/evil'}, 'lib/key'],
        [{type: 'dir', path: 'lib/made', size: null, mtime_ms: 0}, 'lib/made'],
    ]) {
        const to = disk_that_copies_folders({});
        to.links['/home/user/incoming/photos/lib'] = outside;
        const item = await copy_run(disk_that_walks([line]), to, []);
        assert.deepStrictEqual([item.phase, item.said, to.files, to.links], ['error', refusal_of(rel), {'/home/user/incoming/photos/': ''}, {'/home/user/incoming/photos/lib': outside}], rel);
    }
    const alone = disk_that_copies_folders({});
    const both = await copy_run(disk_that_walks([{type: 'link', path: 'lib', size: null, mtime_ms: 0, target: outside}, {type: 'link', path: 'lib/key', size: null, mtime_ms: 0, target: '/tmp/evil'}]), alone, []);
    assert.deepStrictEqual([both.phase, both.said, alone.links], ['error', refusal_of('lib/key'), {'/home/user/incoming/photos/lib': outside}]);

    // The folder's own name is a link in the folder copied into, one a copy before made there
    // or the owner, and leads out of it: the folder is not made through it, in a tar or file by
    // file, and the copy says so
    for (const tars of [true, false]) {
        const to = disk_that_copies_folders({'/home/user/outside/kept.txt': 'kept'});
        to.links['/home/user/incoming/photos'] = outside;
        const from = disk_that_copies_folders({'/srv/photos/keys.txt': key});
        from.can = function () {
            return tars;
        };
        const item = await copy_run(from, to, []);
        assert.deepStrictEqual([item.phase, item.said, item.wait_s], ['error', 'on desktop the name photos leads out of the folder copied into, "/home/user/incoming": nothing was copied', 0], `tars: ${tars}`);
        assert.deepStrictEqual([to.files, to.tars, to.parts], [{'/home/user/outside/kept.txt': 'kept'}, [], {}], `tars: ${tars}`);
    }

    // A file that may not be written says EACCES too, in the disk's other words: it is left
    // out alone as before, whatever its name says, and the folder goes on
    const closed = disk_that_copies_folders({});
    const finish = closed.part_finish;
    closed.part_finish = async function (dir, name, id, size, mode) {
        if (name === 'what is outside.txt') {
            throw new Error(`EACCES: permission denied, open '${dir}/${name}'`);
        }
        return await finish(dir, name, id, size, mode);
    };
    const named = disk_that_walks([{type: 'file', path: 'a.jpg', size: 1, mtime_ms: 0, mode: 0o644}, {type: 'file', path: 'what is outside.txt', size: 1, mtime_ms: 0, mode: 0o644}]);
    named.files['/srv/photos/what is outside.txt'] = 'x';
    const left = await copy_run(named, closed, []);
    assert.deepStrictEqual([left.phase, left.said, left.left.names.map(v => v.path), closed.files['/home/user/incoming/photos/a.jpg']], ['ok', '1 name could not be copied', ['what is outside.txt'], 'a']);
});

// What a folder's copy did before it was kept within its folder, it still does: the owner's
// own links inside the folder, a link that points out of it copied again, a folder under any
// name, into any folder. And a host that cannot keep the disk within a folder says why once.
test('a folder kept within itself still copies through a link that stays inside, over a link copied before, under any name; a host that cannot keep it so ends the copy with its words', async function () {
    // The owner's own link inside the folder, to a folder inside it: written through as before.
    // A link that points out of the folder is made as it was, and is no refusal the second time.
    const from = disk_that_copies_folders({'/srv/photos/current/app.js': 'new', '/srv/photos/a.jpg': 'a'});
    from.links['/srv/photos/up'] = '../shared';
    from.links['/srv/photos/sub/abs'] = '/etc/hosts';
    const to = disk_that_copies_folders({'/home/user/incoming/photos/v1/app.js': 'old'});
    to.links['/home/user/incoming/photos/current'] = 'v1';
    const asked = [];
    function disk_of(name, within) {
        asked.push([name, within]);
        return disks_of({laptop: from, desktop: to})(name, within);
    }
    for (const turn of ['first', 'second']) {
        const queue = transfer_queue({disk_of, small_bytes: 20});
        const item = queue.add({disk: 'laptop', path: '/srv/photos'}, {disk: 'desktop', dir: '/home/user/incoming'});
        await until(() => item.phase !== 'copying');
        assert.deepStrictEqual([item.phase, item.said, item.files_done, item.path], ['ok', '', 2, '/home/user/incoming/photos'], turn);
        assert.deepStrictEqual([to.files['/home/user/incoming/photos/current/app.js'], to.files['/home/user/incoming/photos/a.jpg']], ['new', 'a'], turn);
        assert.deepStrictEqual(to.links, {'/home/user/incoming/photos/current': 'v1', '/home/user/incoming/photos/up': '../shared', '/home/user/incoming/photos/sub/abs': '/etc/hosts'}, turn);
    }
    assert.deepStrictEqual(Array.from(new Set(asked.filter(v => (v[0] === 'desktop') && (v[1] !== undefined)).map(v => v[1]))).sort(), ['/home/user/incoming', '/home/user/incoming/photos'], 'the disk copied to is asked for within the folder copied into, for the folder itself, and within the folder the copy makes');
    assert.strictEqual(asked.every(v => (v[0] !== 'laptop') || (v[1] === undefined)), true, 'the disk copied from is asked for as itself');

    // The folder's own name is the owner's link to a folder beside it, inside the folder copied
    // into: the copy goes where it leads, as before
    const linked = disk_that_copies_folders({'/home/user/incoming/2023/old.jpg': 'old'});
    linked.links['/home/user/incoming/photos'] = '2023';
    const through = transfer_queue({disk_of: disks_of({laptop: from, desktop: linked}), small_bytes: 20}).add({disk: 'laptop', path: '/srv/photos'}, {disk: 'desktop', dir: '/home/user/incoming'});
    await until(() => through.phase !== 'copying');
    assert.deepStrictEqual([through.phase, through.said, through.files_done, linked.files['/home/user/incoming/photos/a.jpg']], ['ok', '', 2, 'a']);

    // A folder under any name, into the disk's top and into a folder not there yet; in it a
    // folder and a file called `~`, which is a name there and nobody's home. In tars and alone.
    for (const name of ['-rf', '.config', 'with space', 'ünï 日本', '~', '..hidden']) {
        for (const dir of ['/', '/not/there/yet']) {
            for (const tars of [true, false]) {
                const source = disk_that_copies_folders({[`/srv/${name}/~/x/big.bin`]: 'b'.repeat(30), [`/srv/${name}/~/-y`]: 'y', [`/srv/${name}/~/empty/`]: '', [`/srv/${name}/sub/~`]: 'a file'});
                source.links[`/srv/${name}/~/l`] = '~';
                source.can = function () {
                    return tars;
                };
                const target = disk_that_copies_folders({});
                const queue = transfer_queue({disk_of: disks_of({laptop: source, desktop: target}), part_bytes: 10, small_bytes: 20});
                const item = queue.add({disk: 'laptop', path: `/srv/${name}`}, {disk: 'desktop', dir});
                await until(() => item.phase !== 'copying');
                const top = path.posix.join(dir, name);
                const said = `${name} into ${dir}, tars: ${tars}`;
                assert.deepStrictEqual([item.phase, item.said, item.files_done, item.path], ['ok', '', 3, top], said);
                // The folder of the link is one the copy made on the way to it
                assert.deepStrictEqual(target.files, {[`${top}/`]: '', [`${top}/~/`]: '', [`${top}/~/x/big.bin`]: 'b'.repeat(30), [`${top}/~/-y`]: 'y', [`${top}/~/empty/`]: '', [`${top}/sub/~`]: 'a file'}, said);
                assert.deepStrictEqual(target.links, {[`${top}/~/l`]: '~'}, said);
            }
        }
    }

    // A folder called `~` into a folder written without a root, which a disk reads under its
    // home: the folder it makes is asked for as ./~, a name there, and never as the home
    for (const tars of [true, false]) {
        const source = disk_that_copies_folders({'/srv/~/x/big.bin': 'b'.repeat(30), '/srv/~/a.txt': 'a'});
        source.links['/srv/~/l'] = 'a.txt';
        source.can = function () {
            return tars;
        };
        const target = disk_that_copies_folders({});
        const withins = [];
        const queue = transfer_queue({
            disk_of: function (name, within) {
                withins.push(within);
                return disks_of({laptop: source, desktop: target})(name, within);
            },
            part_bytes: 10,
            small_bytes: 20,
        });
        const item = queue.add({disk: 'laptop', path: '/srv/~'}, {disk: 'desktop', dir: '.'});
        await until(() => item.phase !== 'copying');
        assert.deepStrictEqual([item.phase, item.said, item.files_done, item.path, Array.from(new Set(withins.filter(v => v !== undefined))).sort()], ['ok', '', 2, './~', ['.', './~']], `tars: ${tars}`);
        assert.deepStrictEqual([target.files, target.links], [{'/home/user/~/': '', '/home/user/~/x/big.bin': 'b'.repeat(30), '/home/user/~/a.txt': 'a'}, {'./~/l': 'a.txt'}], `tars: ${tars}`);
    }

    // A folder's copy given up while a file of it is on its way: the part is taken away through
    // the kept disk, from the folder it was being written in
    const slow = disk_that_copies_folders({});
    const removed = [];
    let hanging = false;
    slow.part_write = function (dir, name, id, offset, source) {
        hanging = true;
        return new Promise((resolve, reject) => source.on('error', reject));
    };
    const remove = slow.part_remove;
    slow.part_remove = async function (dir, name, id) {
        removed.push([dir, name]);
        return await remove(dir, name, id);
    };
    const given_queue = transfer_queue({disk_of: disks_of({laptop: disk_that_copies_folders({'/srv/photos/sub/big.bin': 'b'.repeat(30)}), desktop: slow}), part_bytes: 10, small_bytes: 20});
    const given = given_queue.add({disk: 'laptop', path: '/srv/photos'}, {disk: 'desktop', dir: '/home/user/incoming'});
    await until(() => hanging);
    given_queue.cancel(given.id);
    await until(() => given.phase === 'cancelled');
    await until(() => removed.length > 0);
    assert.deepStrictEqual(removed, [['/home/user/incoming/photos/sub', 'big.bin']]);

    // A host that cannot keep the disk within a folder (an agent from before it) throws, and
    // the folder's copy ends with its words, before the folder is walked and with nothing
    // written; a file alone goes to the same disk as before.
    const words = 'the agent on desktop is from before a folder\'s copy is kept within its folder';
    const old = disk_that_copies_folders({});
    let walks = 0;
    const tree = from.tree;
    from.tree = function (dir) {
        walks++;
        return tree(dir);
    };
    const logged = [];
    const queue = transfer_queue({
        disk_of: function (name, within) {
            if (within !== undefined) {
                throw new Error(words);
            }
            return {laptop: from, desktop: old}[name];
        },
        log: (event_name, fields) => logged.push([event_name, fields]),
    });
    const refused = queue.add({disk: 'laptop', path: '/srv/photos'}, {disk: 'desktop', dir: '/home/user/incoming'});
    await until(() => refused.phase !== 'copying');
    assert.deepStrictEqual([refused.phase, refused.said, refused.wait_s, walks, old.files, old.links], ['error', words, 0, 0, {}, {}]);
    assert.deepStrictEqual(logged.map(v => v[0]).concat([logged[1][1]]), ['transfer_begin', 'transfer_end_error', {id: refused.id, reason: words}]);
    const file = queue.add({disk: 'laptop', path: '/srv/photos/a.jpg'}, {disk: 'desktop', dir: '/home/user/incoming'});
    await until(() => file.phase !== 'copying');
    assert.deepStrictEqual([file.phase, file.path, old.files], ['ok', '/home/user/incoming/a.jpg', {'/home/user/incoming/a.jpg': 'a'}]);
});

test('the room left on a folder\'s disk, for an upload to check it fits; a disk that cannot say answers 501, a refusal 502', async function (t) {
    const disk = disk_in_memory({'/home/user/a.txt': 'a'});
    const running = await serve(t, {disk});

    // A folder not made yet is the disk's to measure, at the nearest one that is
    const room = await call(running, 'GET', `/fs/room?path=${encodeURIComponent('/home/user/new folder')}`);
    assert.deepStrictEqual([room.status, JSON.parse(room.body)], [200, {bytes_free: 5000000000, inodes_free: 300000}]);
    assert.deepStrictEqual(disk.measured, ['/home/user/new folder']);
    assert.strictEqual((await call(running, 'POST', '/fs/room?path=/home/user')).status, 404);

    // A disk that counts no inodes says null, whatever it left out
    disk.room = async function () {
        return {bytes_free: 7};
    };
    assert.deepStrictEqual(JSON.parse((await call(running, 'GET', '/fs/room?path=/home/user')).body), {bytes_free: 7, inodes_free: null});

    // A disk that refuses
    disk.room = async function () {
        throw new Error('ENOTDIR: /home/user/a.txt/x');
    };
    const refused = await call(running, 'GET', '/fs/room?path=/home/user/a.txt/x');
    assert.deepStrictEqual([refused.status, JSON.parse(refused.body)], [502, {error: 'ENOTDIR: /home/user/a.txt/x'}]);

    // A disk that cannot say: the page uploads without asking
    const plain_disk = disk_in_memory({});
    delete plain_disk.room;
    const plain = await serve(t, {disk: plain_disk});
    const unknown = await call(plain, 'GET', '/fs/room?path=/home/user');
    assert.deepStrictEqual([unknown.status, JSON.parse(unknown.body)], [501, {error: 'this disk cannot say how much room it has'}]);
});

test('many files as one tar: written as they come, with their times; a bad name refuses the tar, before the disk is asked when it is the first', async function (t) {
    const disk = disk_in_memory({'/home/user/old.txt': 'old'});
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
    const landed = await call(running, 'POST', '/fs/upload/tar?dir=/home/user/in', tarred);
    assert.deepStrictEqual([landed.status, JSON.parse(landed.body)], [200, {files: 3, bytes: 11}]);
    assert.deepStrictEqual([disk.files['/home/user/in/a/b/deep.txt'], disk.files['/home/user/in/top.txt'], disk.files[`/home/user/in/${long}`]], ['deep', 'top', 'long']);
    assert.strictEqual(disk.files['/home/user/in/empty/'], '', 'an empty folder is made');
    assert.strictEqual(disk.times['/home/user/in/top.txt'], 1600000000, 'a file keeps the time it had');
    assert.deepStrictEqual(logged, [['files_copied', {dir: '/home/user/in', files: 3, bytes: 11, ms: logged[0][1].ms}]]);

    // Written by hand: a long name, a ustar prefix, a link passed over
    const by_hand = tar_of([
        {name: '././@LongLink', type: 'L', text: `${'x'.repeat(150)}.txt\0`},
        {name: 'x'.repeat(99), text: 'long'},
        {prefix: 'p/'.repeat(60).slice(0, -1), name: 'prefixed.txt', text: 'pre', mtime: 1500000000},
        {name: 'link', type: '2'},
    ]);
    assert.deepStrictEqual(JSON.parse((await call(running, 'POST', '/fs/upload/tar?dir=/home/user/hand', by_hand)).body), {files: 2, bytes: 7});
    assert.strictEqual(disk.files[`/home/user/hand/${'x'.repeat(150)}.txt`], 'long');
    assert.strictEqual(disk.files[`/home/user/hand/${'p/'.repeat(60)}prefixed.txt`], 'pre');
    assert.strictEqual(disk.times[`/home/user/hand/${'p/'.repeat(60)}prefixed.txt`], 1500000000);

    // A first name that walks out, or is absolute: refused before the disk is asked
    const tars = disk.tars.length;
    const out_of = await call(running, 'POST', '/fs/upload/tar?dir=/home/user', tar_of([{name: '../escape.txt', text: 'x'}]));
    assert.deepStrictEqual([out_of.status, JSON.parse(out_of.body).error], [400, '"../escape.txt" walks out of the folder the tar is sent to']);
    const absolute = await call(running, 'POST', '/fs/upload/tar?dir=/home/user', tar_of([{name: '/etc/passwd', text: 'x'}]));
    assert.deepStrictEqual([absolute.status, /is an absolute name/.test(JSON.parse(absolute.body).error)], [400, true]);
    assert.strictEqual(disk.tars.length, tars, 'the disk was not asked');

    // A bad name later: what came before it is in, nothing after it
    const later = await call(running, 'POST', '/fs/upload/tar?dir=/home/user/later', tar_of([{name: 'one.txt', text: '1'}, {name: 'a/../../two.txt', text: '2'}, {name: 'three.txt', text: '3'}]));
    assert.deepStrictEqual([later.status, /walks out/.test(JSON.parse(later.body).error)], [400, true]);
    assert.deepStrictEqual(Object.keys(disk.files).filter(v => v.startsWith('/home/user/later/')), ['/home/user/later/one.txt']);
    assert.strictEqual(disk.files['/home/user/two.txt'], undefined);

    // A body that stops before the tar ends, or is no tar at all
    const whole = tar_of([{name: 'cut.txt', text: 'x'.repeat(2000)}]);
    const cut = await call(running, 'POST', '/fs/upload/tar?dir=/home/user/cut', whole.subarray(0, 1024));
    assert.deepStrictEqual([cut.status, JSON.parse(cut.body).error], [400, 'the tar was cut before its end']);
    assert.strictEqual(disk.files['/home/user/cut/cut.txt'], undefined, 'no half file');
    const junk = await call(running, 'POST', '/fs/upload/tar?dir=/home/user', Buffer.alloc(1024, 'j'));
    assert.deepStrictEqual([junk.status, /not a tar/.test(JSON.parse(junk.body).error)], [400, true]);
    assert.strictEqual((await call(running, 'POST', '/fs/upload/tar', whole)).status, 400);
    assert.strictEqual(logged.length, 2, 'one line a tar, for the two that went in');

    // A disk that refuses, and one that takes no tar
    disk.write_tar = async function () {
        throw new Error('EACCES: /home/user/locked');
    };
    const refused = await call(running, 'POST', '/fs/upload/tar?dir=/home/user/locked', whole);
    assert.deepStrictEqual([refused.status, JSON.parse(refused.body)], [502, {error: 'EACCES: /home/user/locked'}]);
    const plain_disk = disk_in_memory({});
    delete plain_disk.write_tar;
    const plain = await serve(t, {disk: plain_disk});
    const unknown = await call(plain, 'POST', '/fs/upload/tar?dir=/home/user', whole);
    assert.deepStrictEqual([unknown.status, JSON.parse(unknown.body)], [501, {error: 'this disk cannot take a tar'}]);
});

test('a size in a tar that is no whole number of 0 or more refuses the tar at that header and names the entry; a time or a mode that is none is 0', function () {
    // What a header's size field may not hold, and parseInt reads as a number or as NaN, which
    // is over no limit and equal to no zero: the bytes that followed were counted against it
    const not_sizes = {
        'letters': 'zzzzzzzzzzz\0',
        'a letter after digits': '0000000012z\0',
        'a minus': '-0000001000\0',
        'a plus': '+0000001000\0',
        '0x': '0x000000010\0',
        'a fraction': '0000001.500\0',
        'an 8 and a 9': '00000000089\0',
        'base-256 below zero': Buffer.from('fffffffffffffffffffffe00', 'hex'),
        'base-256 past what a number counts whole': Buffer.from('800000400000000000000000', 'hex'),
    };
    const whats = {'0': '"photos/a.jpg"', '5': '"photos/a.jpg"', '2': '"photos/a.jpg"', 'x': 'a pax header', 'L': 'a long name', 'g': 'the pax header of the whole tar'};
    for (const said of Object.keys(not_sizes)) {
        for (const type of Object.keys(whats)) {
            // The header alone: the reader refuses it before a byte after it is read
            const header = tar_of([{name: './photos/a.jpg', type, size: not_sizes[said]}]).subarray(0, 512);
            assert.throws(() => tar_parser().push(header), v => (v.code === 'ETARHEADER') && (v.message === `the tar is broken: the size of ${whats[type]} is not a whole number of bytes`) && (v.at === 0), `${said}, in a header of type ${type}`);
        }
    }
    // The same in a pax record, which Number reads its own way: refused at the entry the size
    // is for, by that entry's name
    for (const size of ['zzz', '-512', '0x10', '1e3', '5.5', ' 5', '', '99999999999999999999']) {
        const tarred = tar_of([{name: 'PaxHeaders/a.jpg', type: 'x', text: pax_of({size})}, {name: 'photos/a.jpg', text: 'hello'}]);
        const parser = tar_parser();
        assert.deepStrictEqual(parser.push(tarred.subarray(0, 1024)), []);
        assert.throws(() => parser.push(tarred.subarray(1024, 1536)), v => (v.code === 'ETARHEADER') && (v.message === 'the tar is broken: the size of "photos/a.jpg" is not a whole number of bytes'), `a pax size of ${JSON.stringify(size)}`);
    }
    // The folder the tar is sent to is named as `.`, and a name of any length as its start
    assert.throws(() => tar_parser().push(tar_of([{name: './', type: '5', size: 'zzzzzzzzzzz\0'}]).subarray(0, 512)), /^Error: the tar is broken: the size of "\." is not a whole number of bytes$/);
    const long = tar_of([{name: '././@LongLink', type: 'L', text: `${'n'.repeat(5000)}\0`}, {name: 'n', size: 'zzzzzzzzzzz\0'}]);
    assert.throws(() => tar_parser().push(long), v => (v.message === `the tar is broken: the size of "${'n'.repeat(199)}… is not a whole number of bytes`));

    // What honest tars write is read as it was: GNU's digits and a NUL, bsdtar's digits and a
    // space, an old tar's spaces before the digits, an empty field as 0, GNU's base-256 for a
    // file past 8 GB, pax's digits
    function first_of(entry) {
        return tar_parser().push(tar_of([entry]))[0];
    }
    assert.deepStrictEqual(first_of({name: 'a', text: 'hello', mode: '000755 \0', size: '00000000005 ', mtime: '13727410000 '}), {type: 'file', name: 'a', size: 5, mtime_s: 1600000000, mode: 0o755});
    assert.deepStrictEqual(first_of({name: 'a', text: 'hello', mode: '    755\0', size: '          5 ', mtime: ' 13727410000'}), {type: 'file', name: 'a', size: 5, mtime_s: 1600000000, mode: 0o755});
    assert.deepStrictEqual(first_of({name: 'a', mode: Buffer.alloc(8), size: Buffer.alloc(12), mtime: '            '}), {type: 'file', name: 'a', size: 0, mtime_s: 0, mode: 0});
    const big = tar_parser();
    assert.deepStrictEqual(big.push(tar_of([{name: 'big.bin', size: Buffer.from('800000000000000240000000', 'hex')}]).subarray(0, 512)), [{type: 'file', name: 'big.bin', size: 9*1024*1024*1024, mtime_s: 0, mode: 0o644}]);
    assert.deepStrictEqual(big.push(Buffer.alloc(1024*1024, 'b')).map(v => [v.type, v.bytes.length]), [['data', 1024*1024]]);
    const by_pax = tar_parser().push(tar_of([{name: 'PaxHeaders/a', type: 'x', text: pax_of({size: '5', mtime: '1600000000.123456789'})}, {name: 'a', text: 'hello', size: 0}]));
    assert.deepStrictEqual(by_pax.slice(0, 2), [{type: 'file', name: 'a', size: 5, mtime_s: 1600000000.123456789, mode: 0o644}, {type: 'data', bytes: Buffer.from('hello')}]);

    // A time counts nothing and refuses nothing. One that is none is 0, the start of 1970, and
    // so is one before 1970, which GNU writes in base-256, pax with a minus, and the page's own
    // tar (tar_blob) as octal digits after a minus; one past 2242, in GNU's base-256, is kept
    for (const mtime of ['zzzzzzzzzzz\0', '-2263773600\0', '0000-250600\0', '0000001.500\0', Buffer.from('ffffffffffffffffed300800', 'hex')]) {
        assert.strictEqual(first_of({name: 'a', text: 'hello', mtime}).mtime_s, 0, JSON.stringify(mtime));
    }
    assert.strictEqual(first_of({name: 'a', text: 'hello', mtime: Buffer.from('80000000000000026cb5db00', 'hex')}).mtime_s, 10413792000);
    for (const mtime of ['-315619200', 'soon', '0x10', '1e3', '', '9'.repeat(400)]) {
        const read = tar_parser().push(tar_of([{name: 'PaxHeaders/a', type: 'x', text: pax_of({mtime})}, {name: 'a', text: 'hello', mtime: 1600000000}]));
        assert.strictEqual(read[0].mtime_s, 0, `a pax mtime of ${JSON.stringify(mtime.slice(0, 20))}`);
    }
    // A mode gives a new file its run bits and nothing else: one that is none gives none
    for (const mode of ['zzzzzzz\0', '-000755\0', '000755z\0', Buffer.from('ffffffffffffffff', 'hex')]) {
        assert.strictEqual(first_of({name: 'a', text: 'hello', mode}).mode, 0, JSON.stringify(mode));
    }
});

// Each is asked of a reader in a process of its own, with all the tar in one chunk as a link
// brings it: a reader that does not come back fails the test there, and does not hold it
test('a size below zero does not send the reader round the same header for ever, and a pax record\'s length made of zeros does not hold it', function () {
    const asked = `
        const tar_parser = require(${JSON.stringify(require.resolve('../server/tar_parser'))});
        const time0 = Date.now();
        let said = 'read';
        try {
            tar_parser().push(require('fs').readFileSync(0));
        }
        catch (error) {
            said = error.message;
        }
        console.log(JSON.stringify({said, ms: Date.now() - time0}));
    `;
    function said_of(tarred) {
        const ran = child_process.spawnSync(process.execPath, ['-e', asked], {input: tarred, timeout: 5000, encoding: 'utf8'});
        return (ran.signal === null) ? JSON.parse(ran.stdout) : {said: `stopped with ${ran.signal} after 5 s, still reading`, ms: 5000};
    }
    for (const type of ['0', '5', 'x']) {
        const below = said_of(tar_of([{name: 'a.txt', type, text: 'x'.repeat(512), size: '-0000001000\0'}]));
        assert.strictEqual(below.said, `the tar is broken: the size of ${(type === 'x') ? 'a pax header' : '"a.txt"'} is not a whole number of bytes`, `type ${type}`);
    }
    // 128 KiB of zeros and a `2 `: a record that says it is two bytes long. The reader read the
    // zeros again from two bytes on, and again: 2.6 s for this many, five minutes for a megabyte
    const zeros = said_of(tar_of([{name: 'PaxHeaders/a', type: 'x', text: `${'0'.repeat(128*1024 - 2)}2 `}, {name: 'a.txt', text: 'hello'}]));
    assert.strictEqual(zeros.said, 'read');
    assert.ok(zeros.ms < 1000, `the pax header was read in ${zeros.ms} ms`);
});

test('a tar whose first header says a size that is no number is refused at that header: the megabytes after it are not kept, the disk is not asked, and the next tar goes in', async function (t) {
    const disk = disk_in_memory({});
    const running = await serve(t, {disk});
    // The header, then megabyte after megabyte until the server answers
    const megabyte = Buffer.alloc(1024*1024, 'z');
    let sent = 0;
    let answered = false;
    const refused = await new Promise(function (resolve, reject) {
        const request = http.request({host: '127.0.0.1', port: running.port, method: 'POST', path: '/fs/upload/tar?dir=/home/user/in'}, function (answer) {
            const chunks = [];
            answered = true;
            answer.on('data', v => chunks.push(v));
            answer.on('end', () => resolve({status: answer.statusCode, body: Buffer.concat(chunks).toString('utf8'), sent}));
        });
        request.on('error', reject);
        request.write(tar_of([{name: 'PaxHeaders/a.txt', type: 'x', size: 'zzzzzzzzzzz\0'}]).subarray(0, 512));
        function more() {
            if ((sent === 32) || answered) {
                request.end();
                return;
            }
            sent++;
            request.write(megabyte, () => setImmediate(more));
        }
        more();
    });
    assert.deepStrictEqual([refused.status, JSON.parse(refused.body)], [400, {error: 'the tar is broken: the size of a pax header is not a whole number of bytes'}]);
    assert.ok(refused.sent < 32, `the refusal came after ${refused.sent} of 32 megabytes, not after the last`);
    assert.deepStrictEqual(disk.tars, [], 'the disk was not asked');

    const landed = await call(running, 'POST', '/fs/upload/tar?dir=/home/user/in', tar_of([{name: 'a.txt', text: 'hello'}]));
    assert.deepStrictEqual([landed.status, JSON.parse(landed.body), disk.files['/home/user/in/a.txt']], [200, {files: 1, bytes: 5}, 'hello']);
});

test('a tar that names nothing is not kept here whole: past two megabytes of it the disk is asked, and holds the rest back', async function (t) {
    const nothings = {
        'empty pax headers, one after another': Buffer.concat(new Array(32768).fill(tar_of([{name: 'PaxHeaders/a', type: 'x'}]).subarray(0, 512))),
        'the folder itself, again and again': Buffer.concat(new Array(32768).fill(tar_of([{name: './', type: '5'}]).subarray(0, 512))),
        'the end of the tar, and megabytes after it': Buffer.concat([Buffer.alloc(1024), Buffer.alloc(16*1024*1024 - 1024, 'z')]),
    };
    for (const said of Object.keys(nothings)) {
        const disk = disk_in_memory({});
        // How much of the body waited here when the disk was asked, and again a moment later
        // with the disk taking none of it
        const held = [];
        disk.write_tar = async function (dir, source) {
            held.push(source.writableLength);
            await timers.setTimeout(100);
            held.push(source.writableLength);
            await bytes_of(source);
            return {files: 0, bytes: 0};
        };
        const running = await serve(t, {disk});
        const answer = await call(running, 'POST', '/fs/upload/tar?dir=/home/user/in', nothings[said]);
        assert.ok([200, 400].includes(answer.status), `${said}: ${answer.status} ${answer.body}`);
        assert.strictEqual(held.length, 2, `${said}: the disk was asked`);
        assert.ok(Math.max(...held) < 3*1024*1024, `${said}: ${held.join(' and ')} bytes of ${nothings[said].length} were held here`);
    }
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
        const dir = ((asked === null) || (asked === '')) ? '/home/user' : asked;
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
    // As a real disk: a name that is there is never replaced, and never moved into
    out.rename = async function (from, to) {
        if ((from !== to) && ((held[to] !== undefined) || folder_has(to))) {
            throw new Error(`${path.posix.basename(to)} is there already`);
        }
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
    // A file is held once its last byte is in, with the time the tar gives it. named(name),
    // when given, hears each name before it is written, and may refuse it (disk_within).
    out.write_tar = async function (dir, source, taken, named) {
        tars.push(dir);
        const parser = tar_parser();
        const out = {files: 0, bytes: 0};
        let file = null;
        for await (const chunk of source) {
            for (const piece of parser.push(chunk)) {
                if ((named !== undefined) && ((piece.type === 'dir') || (piece.type === 'file'))) {
                    named(piece.name);
                }
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

// A disk whose walk of /srv/photos says these lines and no others, between its start and its
// end, and that has no folder_copy, so each file of it goes alone: a machine that says of its
// files what it likes
function disk_that_walks(lines)
{
    const out = disk_that_copies_folders({'/srv/photos/a.jpg': 'a'});
    out.can = function () {
        return false;
    };
    out.tree = function (dir) {
        const said = [{type: 'start', path: dir}].concat(lines, [{type: 'end', hashed: 0, ms: 0}]);
        return stream.Readable.from([Buffer.from(said.map(v => `${JSON.stringify(v)}\n`).join(''))]);
    };
    return out;
}

// A disk whose walk of /srv/photos is honest, a.jpg alone, and whose tar is not: whatever names
// it is asked for, the tar carries these entries. What it was asked goes into `asked`.
function disk_that_tars(entries, asked)
{
    const out = disk_that_copies_folders({'/srv/photos/a.jpg': 'a'});
    out.tar = function (dir, names) {
        asked.push([dir, names]);
        return stream.Readable.from([tar_of(entries)]);
    };
    return out;
}

// What a host gives a queue as disk_of: the disk of a name, and, asked with a folder, that
// disk kept within it, the one a folder's copy is written through
function disks_of(disks)
{
    return function (name, within) {
        return (within === undefined) ? disks[name] : disk_within(disks[name], within);
    };
}

// A disk in memory kept within one folder, as a machine's agent keeps one: the folder is where
// it starts, a path is told from there (`.`, `./a/b`), and one that is not inside the folder,
// once the links on its way are followed, is refused, named as it was asked. A path that starts
// with a root is read from the root, one that starts with `~/` from the home, /home/user, and
// the folder itself, when it has no root, under the home, as an agent reads them. It answers
// what a folder's copy asks, each call passed on to the disk under the full path. A name of a
// tar is asked by its full path, as the agent that reads the tar asks it.
function disk_within(disk, within)
{
    // Where a path really is: each link on its way followed, to where its target says
    function real_of(asked) {
        let out = '';
        for (const part of asked.split('/').filter(v => v !== '')) {
            out = `${out}/${part}`;
            if (disk.links[out] !== undefined) {
                out = path.posix.resolve(path.posix.dirname(out), disk.links[out]);
            }
        }
        return out;
    }
    function plain(asked) {
        const home = (asked === '~') || asked.startsWith('~/');
        return home ? path.posix.join('/home/user', asked.slice(1)) : path.posix.resolve('/home/user', asked);
    }
    function full(asked) {
        let out = path.posix.resolve(plain(within), asked);
        if ((asked === '') || (asked === '~')) {
            out = plain(within);
        }
        else if (path.posix.isAbsolute(asked) || asked.startsWith('~/')) {
            out = plain(asked);
        }
        const top = real_of(plain(within));
        const real = real_of(out);
        if ((real !== top) && (real.startsWith(`${top}/`) === false)) {
            throw new Error(`EACCES: ${JSON.stringify(asked)} is outside the folder this disk is kept within`);
        }
        return out;
    }
    return {
        can: function (feature) {
            return (disk.can === undefined) ? false : disk.can(feature);
        },
        stat: async function (asked) {
            return await disk.stat(full(asked));
        },
        mkdir: async function (asked) {
            return await disk.mkdir(full(asked));
        },
        write_tar: async function (dir, source, taken) {
            return await disk.write_tar(full(dir), source, taken, v => full(path.posix.join(full(dir), v)));
        },
        part_stat: async function (dir, name, id) {
            full(`${dir}/${name}`);
            return await disk.part_stat(full(dir), name, id);
        },
        part_write: async function (dir, name, id, offset, source, taken) {
            full(`${dir}/${name}`);
            return await disk.part_write(full(dir), name, id, offset, source, taken);
        },
        part_finish: async function (dir, name, id, size, mode) {
            full(`${dir}/${name}`);
            return await disk.part_finish(full(dir), name, id, size, mode);
        },
        part_remove: async function (dir, name, id) {
            full(`${dir}/${name}`);
            return await disk.part_remove(full(dir), name, id);
        },
    };
}

// A tar written by hand, entry by entry: {name, prefix, type, text, mtime, mode, size}, then
// its end. A mode, a time or a size that is a number is written as a tar writes it, a size left
// out is that of the text; a string or a Buffer goes into the field as it is.
function tar_of(entries)
{
    const blocks = [];
    for (const entry of entries) {
        const data = Buffer.from((entry.text === undefined) ? '' : entry.text);
        const header = Buffer.alloc(512);
        header.write(entry.name, 0, 100, 'utf8');
        field_put(header, 100, 8, (entry.mode === undefined) ? 0o644 : entry.mode);
        header.write('0000000\0', 108, 'latin1');
        header.write('0000000\0', 116, 'latin1');
        field_put(header, 124, 12, (entry.size === undefined) ? data.length : entry.size);
        field_put(header, 136, 12, (entry.mtime === undefined) ? 0 : entry.mtime);
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

// A number field of a header: a number as its octal digits and a NUL, anything else as given
function field_put(header, at, length, value)
{
    if (typeof value === 'number') {
        header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, at, 'latin1');
        return;
    }
    Buffer.from(value, 'latin1').copy(header, at, 0, length);
}

// The records of a pax header, `<length> <key>=<value>\n` each, the length counting itself
function pax_of(values)
{
    return Object.keys(values).map(function (key) {
        const rest = ` ${key}=${values[key]}\n`;
        const digits = String(rest.length + String(rest.length).length).length;
        return `${rest.length + digits}${rest}`;
    }).join('');
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

// A stream that says each piece on a turn of its own and then ends, as a link does: what a
// listener throws there, nobody catches
function said_in_turns(pieces)
{
    const out = new stream.PassThrough();
    const left = pieces.slice();
    setImmediate(function turn() {
        if (out.destroyed) {
            return;
        }
        if (left.length === 0) {
            out.end();
            return;
        }
        out.write(left.shift());
        setImmediate(turn);
    });
    return out;
}

// Every byte a stream gives, as one Buffer
async function bytes_of(readable)
{
    const chunks = [];
    for await (const chunk of readable) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
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
