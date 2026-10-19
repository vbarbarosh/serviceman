const agent_tar_put = require('../src/agent/src/agent_tar_put');
const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

test('a tar becomes files and folders as its bytes come, cut anywhere, each file with the time it had', async function (t) {
    const from = dir_make(t);
    const to = dir_make(t);
    const long = `${'d'.repeat(120)}/${'f'.repeat(130)}.txt`;
    fs.mkdirSync(path.join(from, 'a', 'b'), {recursive: true});
    fs.mkdirSync(path.join(from, 'empty'));
    fs.mkdirSync(path.join(from, path.dirname(long)));
    fs.writeFileSync(path.join(from, 'a', 'b', 'deep.txt'), 'deep');
    fs.writeFileSync(path.join(from, 'big.bin'), Buffer.alloc(300000, 7));
    fs.writeFileSync(path.join(from, 'empty.txt'), '');
    fs.writeFileSync(path.join(from, long), 'long');
    fs.utimesSync(path.join(from, 'a', 'b', 'deep.txt'), 1600000000, 1600000000);
    fs.utimesSync(path.join(from, 'big.bin'), 1500000000, 1500000000);
    fs.symlinkSync('big.bin', path.join(from, 'link'));
    const tarred = child_process.execFileSync('tar', ['-C', from, '-cf', '-', '.'], {maxBuffer: 16*1024*1024});

    // Chunks of any size, so headers and files are split anywhere
    const said = await tar_send(agent_tar_put({dir: path.join(to, 'in')}), tarred, 1 + Math.floor(Math.random()*700));
    assert.deepStrictEqual(said, {path: path.join(to, 'in'), files: 4, bytes: 300008});
    assert.strictEqual(fs.readFileSync(path.join(to, 'in', 'a', 'b', 'deep.txt'), 'utf8'), 'deep');
    assert.ok(fs.readFileSync(path.join(to, 'in', 'big.bin')).equals(Buffer.alloc(300000, 7)));
    assert.strictEqual(fs.readFileSync(path.join(to, 'in', long), 'utf8'), 'long');
    assert.strictEqual(fs.statSync(path.join(to, 'in', 'empty.txt')).size, 0);
    assert.ok(fs.statSync(path.join(to, 'in', 'empty')).isDirectory());
    assert.strictEqual(fs.existsSync(path.join(to, 'in', 'link')), false, 'a link is passed over');

    // Times as they were where the files came from, so a listing tells a whole file from a cut one
    assert.strictEqual(fs.statSync(path.join(to, 'in', 'a', 'b', 'deep.txt')).mtimeMs, 1600000000000);
    assert.strictEqual(fs.statSync(path.join(to, 'in', 'big.bin')).mtimeMs, 1500000000000);
    assert.deepStrictEqual(names_under(path.join(to, 'in')).filter(v => v.endsWith('.part')), []);
});

test('a file that is there is written over and keeps its mode', async function (t) {
    const from = dir_make(t);
    const to = dir_make(t);
    fs.writeFileSync(path.join(from, 'run.sh'), 'new');
    fs.chmodSync(path.join(from, 'run.sh'), 0o600);
    fs.writeFileSync(path.join(to, 'run.sh'), 'old');
    fs.chmodSync(path.join(to, 'run.sh'), 0o755);
    const tarred = child_process.execFileSync('tar', ['-C', from, '-cf', '-', 'run.sh']);
    assert.deepStrictEqual(await tar_send(agent_tar_put({dir: to}), tarred, 4096), {path: to, files: 1, bytes: 3});
    assert.strictEqual(fs.readFileSync(path.join(to, 'run.sh'), 'utf8'), 'new');
    assert.strictEqual(fs.statSync(path.join(to, 'run.sh')).mode & 0o7777, 0o755);
});

test('a stream cut in a file leaves the files before it whole and no part of that one, under any name', async function (t) {
    const from = dir_make(t);
    const to = dir_make(t);
    fs.writeFileSync(path.join(from, 'a.txt'), 'first');
    fs.writeFileSync(path.join(from, 'b.bin'), Buffer.alloc(200000, 1));
    const tarred = child_process.execFileSync('tar', ['-C', from, '-cf', '-', 'a.txt', 'b.bin']);

    // The link drops halfway through b.bin: the tunnel destroys the stream
    const cut = agent_tar_put({dir: to});
    for (let at = 0; at < 100000; at += 1000) {
        await new Promise(v => cut.write(tarred.subarray(at, at + 1000), v));
    }
    assert.ok(fs.existsSync(path.join(to, '.b.bin.part')), 'b.bin is being written beside its name');
    cut.destroy();
    await until(() => (fs.existsSync(path.join(to, '.b.bin.part')) === false));
    assert.deepStrictEqual(names_under(to), ['a.txt']);
    assert.strictEqual(fs.readFileSync(path.join(to, 'a.txt'), 'utf8'), 'first');

    // The host ends a tar that has not ended: an error, and the same clean-up the tunnel does
    const short = agent_tar_put({dir: path.join(to, 'short')});
    await assert.rejects(tar_send(short, tarred.subarray(0, 100000), 1000), /the tar was cut before its end/);
    short.destroy();
    await until(() => (fs.existsSync(path.join(to, 'short', '.b.bin.part')) === false));
    assert.deepStrictEqual(names_under(path.join(to, 'short')), ['a.txt']);
});

test('a name that walks out of the folder, or is absolute, is refused and nothing of it is written', async function (t) {
    const to = dir_make(t);
    for (const name of ['../escape.txt', '/tmp/escape.txt']) {
        const tarred = Buffer.concat([header_of(name, 1), Buffer.alloc(512, 'x'), Buffer.alloc(1024)]);
        await assert.rejects(tar_send(agent_tar_put({dir: path.join(to, 'in')}), tarred, 4096), v => (v.code === 'ETARNAME'));
    }
    assert.deepStrictEqual(names_under(to), ['in']);
});

// One ustar header of a file, by hand: GNU tar will not write a name like these
function header_of(name, size)
{
    const out = Buffer.alloc(512);
    out.write(name, 0);
    out.write('0000644\0', 100);
    out.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
    out.write('0', 156);
    out.write('        ', 148);
    let sum = 0;
    for (const byte of out) {
        sum += byte;
    }
    out.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    return out;
}

// Writes the bytes the way the tunnel does, each chunk answered before the credit runs out,
// and answers with the line the stream says at the end
function tar_send(socket, bytes, size)
{
    return new Promise(function (resolve, reject) {
        const said = [];
        socket.on('data', v => said.push(v));
        socket.on('end', () => resolve(JSON.parse(Buffer.concat(said).toString('utf8'))));
        socket.on('error', reject);
        for (let at = 0; at < bytes.length; at += size) {
            socket.write(bytes.subarray(at, at + size), function () {});
        }
        socket.end();
    });
}

function names_under(dir)
{
    return fs.readdirSync(dir, {recursive: true}).sort();
}

function dir_make(t)
{
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tar-put-'));
    t.after(() => fs.rmSync(out, {recursive: true, force: true}));
    return out;
}

async function until(ok)
{
    const deadline = Date.now() + 5000;
    while (ok() === false) {
        if (Date.now() > deadline) {
            throw new Error('waited too long');
        }
        await new Promise(v => setTimeout(v, 10));
    }
}
