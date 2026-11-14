const agent_deleted_open = require('../src/agent/src/agent_deleted_open');
const agent_disk_usage = require('../src/agent/src/agent_disk_usage');
const assert = require('assert');
const fs = require('fs');
const mounts_read = require('../src/agent/src/mounts_read');
const net = require('net');
const os = require('os');
const path = require('path');
const test = require('node:test');

// Where a disk's space went: a folder's own folders by size, biggest first, what lies in it
// apart, and a folder the agent cannot read named, since its size is then in no folder
test('a folder is counted as its folders, biggest first, its own files apart, and what cannot be read named', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-usage-'));
    t.after(function () {
        fs.chmodSync(path.join(dir, 'locked'), 0o755);
        fs.rmSync(dir, {recursive: true, force: true});
    });
    fs.mkdirSync(path.join(dir, 'logs/old'), {recursive: true});
    fs.mkdirSync(path.join(dir, 'cache'));
    fs.mkdirSync(path.join(dir, 'locked'));
    fs.writeFileSync(path.join(dir, 'logs/old/big.log'), Buffer.alloc(3*1024*1024, 1));
    fs.writeFileSync(path.join(dir, 'cache/small'), Buffer.alloc(256*1024, 1));
    fs.writeFileSync(path.join(dir, 'locked/secret'), Buffer.alloc(64*1024, 1));
    fs.writeFileSync(path.join(dir, 'here.bin'), Buffer.alloc(512*1024, 1));
    fs.chmodSync(path.join(dir, 'locked'), 0o000);

    const answer = await agent_disk_usage({path: `${dir}/`}, {docker: 'docker'});
    assert.strictEqual(answer.path, dir);
    assert.deepStrictEqual(answer.folders.map(v => path.basename(v.path)).slice(0, 2), ['logs', 'cache']);
    assert.ok(answer.folders[0].size >= 3*1024*1024, 'the log under logs/old counts in logs');
    assert.ok((answer.files >= 512*1024) && (answer.files < 1024*1024), 'here.bin is the folder\'s own');
    assert.strictEqual(answer.total, answer.files + answer.folders.reduce((sum, v) => sum + v.size, 0));
    if (process.getuid() !== 0) {
        assert.deepStrictEqual(answer.unread, [path.join(dir, 'locked')]);
    }
    assert.strictEqual(answer.extras, null, 'docker and the journal only when asked');
    assert.strictEqual(answer.rooted, false, 'no root half here: counted as this user');
    assert.deepStrictEqual(answer.parts, [], 'no disk mounted again in it');
    assert.strictEqual(answer.deleted, null, 'not a place a disk is mounted at: deleted files not looked for');
    await assert.rejects(agent_disk_usage({path: 'var/log'}, {}), /from the root/);
});

// While a count runs, what it has counted so far is there to be asked for, and the folders it
// has yet to say; a second ask for the same folder joins it rather than counting twice
test('a count running says the folders it has counted so far, and those still to come', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-usage-'));
    t.after(function () {
        fs.rmSync(dir, {recursive: true, force: true});
    });
    for (const name of ['a', 'b', 'c']) {
        fs.mkdirSync(path.join(dir, name));
        fs.writeFileSync(path.join(dir, name, 'f'), Buffer.alloc(64*1024, 1));
    }

    assert.deepStrictEqual(agent_disk_usage.progress({path: dir}), {path: dir, counting: false, took_ms: 0, folders: [], waiting: 0, waiting_shown: []});
    const first = agent_disk_usage({path: dir}, {docker: 'docker'});
    const second = agent_disk_usage({path: dir}, {docker: 'docker'});
    const running = agent_disk_usage.progress({path: dir});
    assert.strictEqual(running.counting, true);
    assert.deepStrictEqual(running.folders, [], 'du has said nothing yet');
    assert.deepStrictEqual(running.waiting_shown.map(v => path.basename(v)).sort(), ['a', 'b', 'c']);
    assert.strictEqual(running.waiting, 3);
    const answers = await Promise.all([first, second]);
    assert.deepStrictEqual(answers[0].folders, answers[1].folders);
    assert.strictEqual(answers[0].folders.length, 3);
    assert.strictEqual(agent_disk_usage.progress({path: dir}).counting, false, 'a count that ended is gone');
    assert.throws(() => agent_disk_usage.progress({path: 'tmp'}), /from the root/);
});

// Where the machine has the agent's root half, the count is its: du as root, each folder said
// over the socket as du finishes it, and the answer says it was counted as root; a folder in
// it opens from that count
test('a count is the root half\'s where there is one, and says so', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-usage-'));
    const socket = path.join(dir, 'root.sock');
    fs.mkdirSync(path.join(dir, 'logs'));
    fs.mkdirSync(path.join(dir, 'logs/old'));
    fs.writeFileSync(path.join(dir, 'logs/old/big.log'), Buffer.alloc(agent_disk_usage.KEPT_LEAST + 1024*1024, 1));
    const asked = [];
    // The root half's side of the socket: one line of json in, its lines and its reply out
    const server = net.createServer(function (conn) {
        let rest = '';
        conn.on('data', async function (chunk) {
            rest += chunk.toString('utf8');
            if (rest.includes('\n') === false) {
                return;
            }
            const job = JSON.parse(rest.slice(0, rest.indexOf('\n')));
            asked.push(job.method);
            const value = await agent_disk_usage.root(job.params, function (stream, text) {
                conn.write(`${JSON.stringify({type: 'line', stream, text})}\n`);
            });
            conn.end(`${JSON.stringify({type: 'reply', ok: true, value})}\n`);
        });
    });
    await new Promise(v => server.listen(socket, v));
    t.after(function () {
        server.close();
        fs.rmSync(dir, {recursive: true, force: true});
    });

    const answer = await agent_disk_usage({path: dir}, {docker: 'docker', root_socket: socket});
    assert.deepStrictEqual(asked, ['disk_usage']);
    assert.strictEqual(answer.rooted, true);
    assert.strictEqual(path.basename(answer.folders[0].path), 'logs');
    assert.ok(answer.folders[0].size >= agent_disk_usage.KEPT_LEAST);
    const logs = await agent_disk_usage({path: path.join(dir, 'logs'), kept: true}, {docker: 'docker', root_socket: socket});
    assert.deepStrictEqual(logs.folders.map(v => path.basename(v.path)), ['old']);
    assert.strictEqual(logs.rooted, true);
    assert.deepStrictEqual(asked, ['disk_usage'], 'logs from the same count as root, not a second one');
});

// du reads every folder under the one it counts, so the count keeps them: a folder opened
// after it is answered from it, at once, and a file put there since is not seen until the
// folder is counted again. A folder under KEPT_LEAST is kept without its insides and counted
// on its own when opened; a name with a newline in it stays one name.
test('a folder in a counted one is answered from the same count, until it is counted again', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-usage-'));
    t.after(function () {
        fs.rmSync(dir, {recursive: true, force: true});
    });
    const big = path.join(dir, 'big');
    fs.mkdirSync(path.join(big, 'deep'), {recursive: true});
    fs.mkdirSync(path.join(dir, 'small/inner'), {recursive: true});
    fs.mkdirSync(path.join(dir, 'two\nlines'));
    fs.writeFileSync(path.join(big, 'deep/data.bin'), Buffer.alloc(agent_disk_usage.KEPT_LEAST + 1024*1024, 1));
    fs.writeFileSync(path.join(dir, 'small/inner/f'), Buffer.alloc(64*1024, 1));

    const whole = await agent_disk_usage({path: dir, kept: true}, {docker: 'docker'});
    assert.deepStrictEqual(whole.folders.map(v => path.basename(v.path)), ['big', 'small', 'two\nlines'], 'a newline in a name keeps it one name');
    assert.ok(whole.age_ms < 1000, 'counted just now');
    fs.writeFileSync(path.join(big, 'deep/new.bin'), Buffer.alloc(2*1024*1024, 1));
    fs.writeFileSync(path.join(dir, 'small/inner/g'), Buffer.alloc(64*1024, 1));

    const opened = await agent_disk_usage({path: big, kept: true}, {docker: 'docker'});
    assert.deepStrictEqual(opened.folders, [{path: path.join(big, 'deep'), size: whole.folders[0].size - opened.files}]);
    assert.strictEqual(opened.total, whole.folders[0].size, 'the size the count said: new.bin came after it');
    assert.strictEqual(opened.took_ms, whole.took_ms, 'the same count');
    const deeper = await agent_disk_usage({path: path.join(big, 'deep'), kept: true}, {docker: 'docker'});
    assert.strictEqual(deeper.total, opened.folders[0].size);
    const small = await agent_disk_usage({path: path.join(dir, 'small'), kept: true}, {docker: 'docker'});
    assert.ok(small.folders[0].size >= 128*1024, 'too small to keep: counted on its own, g in it');

    const again = await agent_disk_usage({path: dir}, {docker: 'docker'});
    assert.ok(again.folders[0].size >= whole.folders[0].size + 2*1024*1024, 'counted again: new.bin in it');
    const reopened = await agent_disk_usage({path: big, kept: true}, {docker: 'docker'});
    assert.strictEqual(reopened.total, again.folders[0].size, 'a folder in it opens from the new count');
});

// A folder opened while its disk is being counted waits for that count, not for a count of
// its own, and is answered the moment du has said it; while it waits, what is counted in it
// so far shows. du here is a stand-in that stops halfway.
test('a folder opened while the count runs is answered as soon as du has said it', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-usage-'));
    const bin = path.join(dir, 'bin');
    const PATH = process.env.PATH;
    t.after(function () {
        process.env.PATH = PATH;
        fs.rmSync(dir, {recursive: true, force: true});
    });
    for (const name of ['bin', 'top/a/x', 'top/a/y', 'top/b']) {
        fs.mkdirSync(path.join(dir, name), {recursive: true});
    }
    const top = path.join(dir, 'top');
    const big = agent_disk_usage.KEPT_LEAST;
    fs.writeFileSync(path.join(bin, 'du'), [
        '#!/bin/sh',
        'for v; do top=$v; done',
        `printf '%s\\t%s\\0' ${big} "$top/a/x" 4096 "$top/a/y" ${big + 8192} "$top/a"`,
        'sleep 1',
        `printf '%s\\t%s\\0' 4096 "$top/b" ${big + 16384} "$top"`,
        '',
    ].join('\n'), {mode: 0o755});
    process.env.PATH = `${bin}:${PATH}`;

    const whole = agent_disk_usage({path: top, kept: true}, {docker: 'docker'});
    const opened = await agent_disk_usage({path: path.join(top, 'a'), kept: true}, {docker: 'docker'});
    assert.deepStrictEqual(opened.folders.map(v => path.basename(v.path)), ['x', 'y']);
    assert.strictEqual(opened.files, 4096);
    const running = agent_disk_usage.progress({path: top});
    assert.strictEqual(running.counting, true, 'answered while the count still runs');
    assert.deepStrictEqual(running.folders, [{path: path.join(top, 'a'), size: big + 8192}]);
    assert.deepStrictEqual(running.waiting_shown, [path.join(top, 'b')]);
    assert.deepStrictEqual((await whole).folders.map(v => path.basename(v.path)), ['a', 'b']);
});

// A root half from before whole trees answers the first level alone: what is inside those
// folders is not known, and a folder opened is counted on its own, as it always was
test('a root half from before whole trees still counts each folder opened', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-usage-'));
    const socket = path.join(dir, 'root.sock');
    fs.mkdirSync(path.join(dir, 'logs/old'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'logs/old/big.log'), Buffer.alloc(agent_disk_usage.KEPT_LEAST + 1024*1024, 1));
    const asked = [];
    const server = net.createServer(function (conn) {
        let rest = '';
        conn.on('data', async function (chunk) {
            rest += chunk.toString('utf8');
            if (rest.includes('\n') === false) {
                return;
            }
            const job = JSON.parse(rest.slice(0, rest.indexOf('\n')));
            asked.push(job.params.path);
            // What an older root half did with the same ask: depth was not a word it knew
            const value = await agent_disk_usage.root({path: job.params.path, deleted: job.params.deleted}, function (stream, text) {
                conn.write(`${JSON.stringify({type: 'line', stream, text})}\n`);
            });
            conn.end(`${JSON.stringify({type: 'reply', ok: true, value})}\n`);
        });
    });
    await new Promise(v => server.listen(socket, v));
    t.after(function () {
        server.close();
        fs.rmSync(dir, {recursive: true, force: true});
    });

    const whole = await agent_disk_usage({path: dir, kept: true}, {docker: 'docker', root_socket: socket});
    assert.strictEqual(whole.rooted, true);
    const logs = await agent_disk_usage({path: path.join(dir, 'logs'), kept: true}, {docker: 'docker', root_socket: socket});
    assert.deepStrictEqual(logs.folders.map(v => path.basename(v.path)), ['old']);
    assert.deepStrictEqual(asked, [dir, path.join(dir, 'logs')], 'logs counted on its own');
});

// du names a folder it cannot read in more than one way: by its own path when it is run by
// one, and in quotes of a locale's own where a locale got through
test('a folder du cannot read is found whichever way du names it', function () {
    const text = [
        'du: cannot read directory \'/var/lib/docker\': Permission denied',
        '/usr/bin/du: cannot read directory \'/root\': Permission denied',
        'du: cannot read directory ‘/var/log/journal’: Permission denied',
        'du: cannot access \'/proc/1/fd\': Operation not permitted',
        'du: fts_read failed: No such file or directory',
    ].join('\n');
    assert.deepStrictEqual(agent_disk_usage.unread_of(text), ['/var/lib/docker', '/root', '/var/log/journal', '/proc/1/fd']);
});

// btrfs: / on @ and /home on @home are one filesystem (mountinfo's dev), but stat gives each
// subvolume a dev of its own, so du -x stops at /home. /home and what is mounted under it from
// the same disk are counted apart; another disk, a network share and the root subvolume bound
// again (which du -x goes into already) are not.
test('the same disk mounted again in a folder is counted with it, another disk is not', function () {
    const mounts = [
        {point: '/', dev: '0:30'},
        {point: '/boot', dev: '8:1'},
        {point: '/home', dev: '0:30'},
        {point: '/home/user/cache', dev: '0:30'},
        {point: '/mnt/nas', dev: '0:50'},
        {point: '/srv/www', dev: '0:30'},
        {point: '/proc', dev: '0:22'},
    ];
    const devs = {'/': 31, '/boot': 2049, '/home': 32, '/home/user/cache': 33, '/mnt/nas': 50, '/srv/www': 31, '/proc': 22};
    assert.deepStrictEqual(agent_disk_usage.disk_parts('/', mounts, v => devs[v]), ['/home', '/home/user/cache']);
    assert.deepStrictEqual(agent_disk_usage.disk_parts('/home', mounts, v => devs[v]), ['/home/user/cache']);
    assert.deepStrictEqual(agent_disk_usage.disk_parts('/boot', mounts, v => devs[v]), []);
    assert.deepStrictEqual(agent_disk_usage.disk_parts('/', [], v => devs[v]), [], 'no mount table, nothing to add');

    const tree = {size: 10e9, kids: new Map([['usr', {size: 8e9, kids: null}], ['home', {size: 9e3, kids: new Map()}]])};
    agent_disk_usage.tree_graft(tree, '/', '/home', {size: 400e9, kids: new Map([['user', {size: 350e9, kids: new Map()}]])});
    agent_disk_usage.tree_graft(tree, '/', '/home/user/cache', {size: 30e9, kids: new Map()});
    assert.strictEqual(tree.kids.get('home').size, 430e9, '/home takes its own count in place of its mount point\'s, and its cache in it');
    assert.strictEqual(tree.size, 10e9 - 9e3 + 430e9);
    assert.strictEqual(tree.kids.get('usr').size, 8e9);
    assert.strictEqual(tree.kids.get('home').kids.get('user').size, 380e9, 'the cache grows the folder it sits in');
    assert.strictEqual(tree.kids.get('home').kids.get('user').kids.get('cache').size, 30e9);
});

// A file deleted while it is still open keeps its space, in no folder: it is found by its
// program's open files, on the disk the folder is on, and counted once
test('a file deleted but still open is found, with the program holding it', function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-usage-'));
    const file = path.join(dir, 'gone.log');
    fs.writeFileSync(file, Buffer.alloc(2*1024*1024, 1));
    const fd = fs.openSync(file, 'r');
    const again = fs.openSync(file, 'r');
    fs.unlinkSync(file);
    t.after(function () {
        fs.closeSync(fd);
        fs.closeSync(again);
        fs.rmSync(dir, {recursive: true, force: true});
    });

    const found = agent_deleted_open(dir);
    const own = found.programs.find(v => v.pid === process.pid);
    assert.ok(own !== undefined, 'this test holds it');
    assert.ok((own.size >= 2*1024*1024) && (own.size < 3*1024*1024), 'opened twice, counted once');
    assert.ok(found.size >= own.size);
    assert.deepStrictEqual(agent_deleted_open('/no/such/proc', '/no/such/proc'), {size: 0, programs: []});
});

// mountinfo writes a space in a place's name as \040
test('the mount table is read with the names as they are', function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-usage-'));
    t.after(function () {
        fs.rmSync(dir, {recursive: true, force: true});
    });
    fs.writeFileSync(path.join(dir, 'mountinfo'), [
        '29 1 0:30 /@ / rw,relatime shared:1 - btrfs /dev/nvme0n1p2 rw,subvol=/@',
        '31 29 0:30 /@home /home rw,relatime shared:2 - btrfs /dev/nvme0n1p2 rw,subvol=/@home',
        '40 29 8:1 / /media/My\\040Disk rw - ext4 /dev/sda1 rw',
        '',
    ].join('\n'));
    const mounts = mounts_read(path.join(dir, 'mountinfo'));
    assert.deepStrictEqual(mounts[1], {id: 31, dev: '0:30', root: '/@home', point: '/home', options: ['rw', 'relatime'], type: 'btrfs', source: '/dev/nvme0n1p2', peers: ['shared:2']});
    assert.strictEqual(mounts[2].point, '/media/My Disk');
    assert.strictEqual(mounts_read.mount_of('/home/user', mounts).point, '/home');
    assert.strictEqual(mounts_read.mount_of('/homework', mounts).point, '/');
});
