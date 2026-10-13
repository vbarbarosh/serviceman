const assert = require('assert');
const container_disk = require('../server/container_disk');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const stream = require('stream');
const test = require('node:test');

const ID = 'c'.repeat(64);

test('a container as a File Manager disk: list, stat through a link, read a range, write, rename, mkdir, delete, tar', async function (t) {
    const engine = await engine_start(t);
    const disk = container_disk(() => net.connect(engine.socket), ID);

    // No folder named is the container's working folder; find and stat are run in it
    const listed = await disk.list('');
    assert.strictEqual(listed.path, '/app');
    assert.deepStrictEqual(listed.items, [
        {name: 'conf', kind: 'dir', size: null, mtime_ms: 1759400000000},
        {name: 'a.txt', kind: 'file', size: 5, mtime_ms: 1759400001000},
        {name: 'link.txt', kind: 'file', size: 5, mtime_ms: 1759400001000},
    ]);
    assert.deepStrictEqual(engine.cmds[0], ['find', '/app', '-mindepth', '1', '-maxdepth', '1', '-exec', 'stat', '-L', '-c', '%F/%s/%Y/%n', '{}', '+']);

    // A link is weighed and read as the file it names; a range is a slice of it
    assert.deepStrictEqual(await disk.stat('/app/link.txt'), {kind: 'file', size: 5, mtime_ms: Date.parse('2025-10-02T10:00:00Z'), mode: 0o644});
    assert.strictEqual((await bytes(disk.read('/app/link.txt', null))).toString(), 'hello');
    assert.strictEqual((await bytes(disk.read('//app/a.txt', {start: 1, end: 3}))).toString(), 'ell');
    await assert.rejects(disk.stat('/app/none'), /ENOENT/);

    // A file goes in as an archive of one entry; one that is there keeps its mode
    const source = stream.Readable.from([Buffer.from('new text')]);
    source.headers = {'content-length': '8'};
    assert.deepStrictEqual(await disk.write('/app', 'a.txt', source), {path: '/app/a.txt', bytes: 8, replaced: true});
    const put = engine.puts[0];
    assert.strictEqual(put.url, `/containers/${ID}/archive?path=%2Fapp`);
    assert.strictEqual(put.body.subarray(0, 5).toString(), 'a.txt');
    assert.strictEqual(put.body.subarray(100, 107).toString(), '0000644');
    assert.strictEqual(put.body.subarray(512, 520).toString(), 'new text');
    assert.strictEqual(put.body.length, 512 + 512 + 1024);
    const unsized = stream.Readable.from([Buffer.from('x')]);
    unsized.headers = {};
    await assert.rejects(disk.write('/app', 'b.txt', unsized), /length said first/);

    // The rest are commands run in it, and a failing one says what it said
    await disk.rename('/app/a.txt', '/app/conf/a.txt');
    await disk.mkdir('/app/new/deep');
    await disk.remove('/app/conf');
    assert.deepStrictEqual(engine.cmds.slice(-3), [['mv', '/app/a.txt', '/app/conf/a.txt'], ['mkdir', '-p', '/app/new/deep'], ['rm', '-rf', '/app/conf']]);
    assert.throws(() => disk.remove('/'), /not a thing the File Manager deletes/);
    await assert.rejects(disk.mkdir('/fail'), /mkdir: cannot create/);
    assert.strictEqual((await bytes(disk.tar('/app', ['conf', 'a.txt']))).toString(), 'TARBYTES');
    assert.deepStrictEqual(engine.cmds[engine.cmds.length - 1], ['tar', '-cf', '-', '-C', '/app', 'conf', 'a.txt']);
});

test('a container says the room left on the disk of a folder, made or not yet, as its df does', async function (t) {
    const engine = await engine_start(t);
    const disk = container_disk(() => net.connect(engine.socket), ID);

    // A folder not made yet is measured at the nearest one that is
    assert.deepStrictEqual(await disk.room('/app/conf/new/deep'), {bytes_free: 600*1024, inodes_free: 70});
    assert.deepStrictEqual(engine.cmds, [['df', '-Pk', '/app/conf'], ['df', '-Pi', '/app/conf']]);
    assert.deepStrictEqual(await disk.room(''), {bytes_free: 600*1024, inodes_free: 70});
    assert.deepStrictEqual(engine.cmds.slice(-1), [['df', '-Pi', '/app']]);

    // A df with no -i (busybox), and a disk that counts no inodes (btrfs): no inodes said
    engine.df_inodes = 'unknown';
    assert.deepStrictEqual(await disk.room('/app'), {bytes_free: 600*1024, inodes_free: null});
    engine.df_inodes = 'none';
    assert.deepStrictEqual(await disk.room('/app'), {bytes_free: 600*1024, inodes_free: null});

    // A container with no df in it says so
    engine.df = false;
    await assert.rejects(disk.room('/app'), /executable file not found/);
});

test('many files as one tar go to docker as they come, into a folder made first when it is not there', async function (t) {
    const engine = await engine_start(t);
    const disk = container_disk(() => net.connect(engine.socket), ID);
    const tarred = Buffer.alloc(2048, 't');

    // The length the request said goes on; docker does not count, the door does
    const sized = stream.Readable.from([tarred.subarray(0, 1000), tarred.subarray(1000)]);
    sized.headers = {'content-length': '2048'};
    assert.deepStrictEqual(await disk.write_tar('/app/conf', sized), {files: null, bytes: null});
    assert.deepStrictEqual([engine.puts[0].url, engine.puts[0].length, engine.puts[0].body.equals(tarred)], [`/containers/${ID}/archive?path=%2Fapp%2Fconf`, '2048', true]);
    assert.deepStrictEqual(engine.cmds, [], 'a folder that is there is not made');

    // A folder that is not there is made first; a body of no known length goes chunked
    await disk.write_tar('/app/new/deep', stream.Readable.from([tarred]));
    assert.deepStrictEqual(engine.cmds, [['mkdir', '-p', '/app/new/deep']]);
    assert.deepStrictEqual([engine.puts[1].url, engine.puts[1].length, engine.puts[1].body.length], [`/containers/${ID}/archive?path=%2Fapp%2Fnew%2Fdeep`, undefined, 2048]);

    // A body that breaks on the way stops the copy, and says why
    const broken = new stream.PassThrough();
    const sent = disk.write_tar('/app', broken);
    broken.write('half');
    setTimeout(() => broken.destroy(new Error('the copy was given up before the tar was in')), 50);
    await assert.rejects(sent, /given up/);
});

// The part of the Engine API the disk asks for: inspect, exec (its output in docker's frames),
// the archive's header, the archive of a file (with a long-name header first), and a PUT of one
async function engine_start(t)
{
    const socket = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'docker-engine-')), 'docker.sock');
    // df: whether the container has one; df_inodes: counted, none (btrfs) or unknown (no -i)
    const out = {socket, cmds: [], puts: [], df: true, df_inodes: 'counted'};
    const execs = {};
    const files = {
        '/app/a.txt': {text: 'hello', mode: 0o644},
        '/app/link.txt': {link: '/app/a.txt'},
        '/app': {dir: true},
        '/app/conf': {dir: true},
    };
    const server = http.createServer(function (req, res) {
        const url = new URL(req.url, 'http://docker');
        const chunks = [];
        req.on('data', v => chunks.push(v));
        req.on('end', function () {
            const body = Buffer.concat(chunks);
            if ((req.method === 'GET') && (url.pathname === `/containers/${ID}/json`)) {
                return json(res, 200, {Config: {WorkingDir: '/app'}});
            }
            if ((req.method === 'POST') && (url.pathname === `/containers/${ID}/exec`)) {
                const cmd = JSON.parse(body).Cmd;
                out.cmds.push(cmd);
                const id = `e${Object.keys(execs).length}`;
                execs[id] = cmd;
                return json(res, 201, {Id: id});
            }
            const start = /^\/exec\/(e\d+)\/start$/.exec(url.pathname);
            if (start !== null) {
                const cmd = execs[start[1]];
                res.writeHead(200, {'content-type': 'application/vnd.docker.raw-stream'});
                if (cmd[0] === 'find') {
                    return res.end(frame(1, 'directory/4096/1759400000//app/conf\nregular file/5/1759400001//app/a.txt\nregular file/5/1759400001//app/link.txt\n'));
                }
                if (cmd[0] === 'tar') {
                    return res.end(Buffer.concat([frame(1, 'TAR'), frame(2, 'a warning'), frame(1, 'BYTES')]));
                }
                if ((cmd[0] === 'df') && (out.df === false)) {
                    execs[start[1]].code = 127;
                    return res.end(frame(2, 'exec: "df": executable file not found in $PATH\n'));
                }
                if ((cmd[0] === 'df') && (cmd[1] === '-Pk')) {
                    return res.end(frame(1, `Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 1000 400 600 40% /\n`));
                }
                if ((cmd[0] === 'df') && (out.df_inodes === 'unknown')) {
                    execs[start[1]].code = 1;
                    return res.end(frame(2, 'df: unrecognized option: i\n'));
                }
                if (cmd[0] === 'df') {
                    const counted = ((out.df_inodes === 'counted') ? '100 30 70 30%' : '0 0 0 -');
                    return res.end(frame(1, `Filesystem Inodes IUsed IFree IUse% Mounted on\noverlay ${counted} /\n`));
                }
                if ((cmd[1] === '-p') && (cmd[2] === '/fail')) {
                    execs[start[1]].code = 1;
                    return res.end(frame(2, 'mkdir: cannot create directory /fail\n'));
                }
                return res.end();
            }
            const done = /^\/exec\/(e\d+)\/json$/.exec(url.pathname);
            if (done !== null) {
                return json(res, 200, {ExitCode: ((execs[done[1]].code === undefined) ? 0 : execs[done[1]].code)});
            }
            if (url.pathname === `/containers/${ID}/archive`) {
                const asked = url.searchParams.get('path');
                if (req.method === 'PUT') {
                    out.puts.push({url: req.url, body, length: req.headers['content-length']});
                    res.writeHead(200);
                    return res.end();
                }
                const file = files[asked];
                if (file === undefined) {
                    return json(res, 404, {message: 'no such file'});
                }
                const said = (file.dir ? {name: 'conf', size: 4096, mode: 2147484141, mtime: '2025-10-02T10:00:00Z'} : {name: path.basename(asked), size: (file.link ? 10 : file.text.length), mode: (file.link ? 0o777 : file.mode), mtime: '2025-10-02T10:00:00Z', linkTarget: (file.link ? file.link : asked)});
                res.writeHead(200, {'x-docker-container-path-stat': Buffer.from(JSON.stringify(said)).toString('base64')});
                if (req.method === 'HEAD') {
                    return res.end();
                }
                return res.end(Buffer.concat([tar_entry('x', 'path=a.txt\n'), tar_entry('0', file.text), Buffer.alloc(1024)]));
            }
            json(res, 404, {message: `no such path ${req.url}`});
        });
    });
    await new Promise(v => server.listen(socket, v));
    t.after(() => new Promise(vv => server.close(vv)));
    return out;
}

function frame(kind, text)
{
    const data = Buffer.from(text);
    const header = Buffer.alloc(8);
    header[0] = kind;
    header.writeUInt32BE(data.length, 4);
    return Buffer.concat([header, data]);
}

function tar_entry(type, text)
{
    const header = Buffer.alloc(512);
    header.write('entry', 0);
    header.write(`${Buffer.byteLength(text).toString(8).padStart(11, '0')}\0`, 124);
    header.write(type, 156);
    const data = Buffer.from(text);
    return Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}

function json(res, status, value)
{
    res.writeHead(status, {'content-type': 'application/json'});
    res.end(JSON.stringify(value));
}

async function bytes(readable)
{
    const chunks = [];
    for await (const chunk of readable) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}
