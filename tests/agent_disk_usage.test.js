const agent_disk_usage = require('../src/agent/src/agent_disk_usage');
const assert = require('assert');
const fs = require('fs');
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
// over the socket as du finishes it, and the answer says it was counted as root
test('a count is the root half\'s where there is one, and says so', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-usage-'));
    const socket = path.join(dir, 'root.sock');
    fs.mkdirSync(path.join(dir, 'logs'));
    fs.writeFileSync(path.join(dir, 'logs/big.log'), Buffer.alloc(1024*1024, 1));
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
    assert.ok(answer.folders[0].size >= 1024*1024);
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
