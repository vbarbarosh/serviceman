const assert = require('assert');
const file_manager_serve = require('../server/file_manager_serve');
const file_manager_transfers_serve = require('../server/file_manager_transfers_serve');
const http = require('http');
const stream = require('stream');
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
    const running = await serve(t, {disk, name: 'box', log: (event, fields) => logged.push([event, fields])});

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
    const queue = transfer_queue({disk_of: v => (away[v] ? null : {a, b}[v]), log: (event, fields) => logged.push(event), part_bytes: 10});

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

test('the copies API lists, starts, cancels and clears; a copy names known disks only', async function (t) {
    const a = disk_in_memory({'/a/film.bin': 'film'});
    const b = disk_in_memory({});
    const queue = transfer_queue({disk_of: v => (({a, b}[v] === undefined) ? null : {a, b}[v])});
    const server = http.createServer(function (req, res) {
        const pathname = new URL(req.url, 'http://test.invalid').pathname;
        file_manager_transfers_serve(req, res, {queue, tail: pathname.slice('/transfers'.length), disk_known: v => ((v === 'a') || (v === 'b'))});
    });
    await new Promise(v => server.listen(0, '127.0.0.1', v));
    t.after(() => new Promise(vv => server.close(vv)));
    const running = {port: server.address().port};

    assert.strictEqual((await call(running, 'POST', '/transfers', JSON.stringify({from: {disk: 'z', path: '/a/film.bin'}, to: {disk: 'b', dir: '/b'}}))).status, 400);
    assert.strictEqual((await call(running, 'POST', '/transfers', JSON.stringify({from: {disk: 'a', path: '/a/film.bin'}, to: {disk: 'b', dir: ' '}}))).status, 400);
    assert.strictEqual((await call(running, 'POST', '/transfers', 'not json')).status, 400);
    const started = JSON.parse((await call(running, 'POST', '/transfers', JSON.stringify({from: {disk: 'a', path: '/a/film.bin'}, to: {disk: 'b', dir: '/b'}}))).body);
    assert.strictEqual(started.name, 'film.bin');
    await until(() => queue.items[0].phase === 'ok');
    const listed = JSON.parse((await call(running, 'GET', '/transfers')).body).items;
    assert.deepStrictEqual([listed.length, listed[0].phase, listed[0].received, listed[0].wake], [1, 'ok', 4, undefined]);
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
    const running = await serve(t, {disk, log: (event, fields) => logged.push([event, fields])});

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
        const req = http.get({host: '127.0.0.1', port: big.port, path: '/fs?path=/big&tree=1&delay=20', headers: {accept: 'text/event-stream'}}, function (res) {
            res.resume();
            setTimeout(function () {
                req.destroy();
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
    const running = await serve(t, {disk, log: (event, fields) => logged.push([event, fields])});

    // The answer waits for ready, then each line of the disk is one event
    const events = [];
    let status = null;
    const req = http.request({host: '127.0.0.1', port: running.port, path: '/fs/watch?path=/home/me&tree=1&skip=node_modules&skip=.git'}, function (res) {
        status = [res.statusCode, res.headers['content-type']];
        res.on('data', v => events.push(...v.toString('utf8').split('\n\n').filter(vv => vv !== '')));
    });
    req.end();
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
    req.destroy();
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

// A disk held in an object: path -> text, a folder as a path that ends in a slash or as the
// folder of a file. Enough of a disk to answer every call the way a real one does.
function disk_in_memory(files)
{
    const held = Object.assign({}, files);
    // A file in parts: what is in so far, kept by upload id
    const parts = {};
    const out = {files: held, parts};
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
        const dir = (((asked === null) || (asked === '')) ? '/home/me' : asked);
        const names = new Set();
        for (const key of Object.keys(held)) {
            if (key.startsWith(`${dir}/`)) {
                names.add(key.slice(dir.length + 1).split('/')[0]);
            }
        }
        const items = Array.from(names).filter(v => v !== '').map(function (name) {
            const stat = stat_of(`${dir}/${name}`);
            return {name, kind: stat.kind, size: ((stat.kind === 'file') ? stat.size : null), mtime_ms: 0};
        });
        items.sort((a, b) => ((a.kind === b.kind) ? a.name.localeCompare(b.name) : ((a.kind === 'dir') ? -1 : 1)));
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
    out.part_stat = async function (dir, name, id) {
        return {received: ((parts[id] === undefined) ? 0 : parts[id].length)};
    };
    out.part_write = async function (dir, name, id, offset, source) {
        const had = ((parts[id] === undefined) ? '' : parts[id]);
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
    out.part_finish = async function (dir, name, id, size) {
        const have = ((parts[id] === undefined) ? '' : parts[id]);
        if (have.length !== size) {
            throw new Error(`the file has ${have.length} bytes so far, not ${size}`);
        }
        const full = `${dir}/${name}`;
        const replaced = (held[full] !== undefined);
        held[full] = have;
        delete parts[id];
        return {path: full, bytes: size, replaced};
    };
    out.part_remove = async function (dir, name, id) {
        delete parts[id];
        return {};
    };
    return out;
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
    t.after(() => new Promise(vv => server.close(vv)));
    return {port: server.address().port};
}

function call(running, method, path, body, headers)
{
    return new Promise(function (resolve, reject) {
        const req = http.request({host: '127.0.0.1', port: running.port, method, path, headers}, function (res) {
            const chunks = [];
            res.on('data', v => chunks.push(v));
            res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8')}));
        });
        req.on('error', reject);
        req.end(((body === undefined) || (body === null)) ? undefined : body);
    });
}

async function until(ok, timeout_ms)
{
    const end = Date.now() + ((timeout_ms === undefined) ? 5000 : timeout_ms);
    while (ok() === false) {
        if (Date.now() > end) {
            throw new Error('waited too long');
        }
        await new Promise(v => setTimeout(v, 20));
    }
}
