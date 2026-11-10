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

// The host sends the tar, and in a folder's copy it is what another machine sent the host. A
// size of letters was counted against for as long as bytes came, and each of them was kept; one
// below zero, with its header and the block after it in one chunk, was a write that never came
// back.
test('a size that is no whole number of 0 or more ends the tar at its header, and nothing of the entry is written', async function (t) {
    const to = dir_make(t);
    for (const size of ['zzzzzzzzzzz\0', '-0000001000\0']) {
        for (const type of ['0', 'x']) {
            // A block at a time, the header alone first: the refusal is of the header itself
            const tarred = Buffer.concat([header_of('a.txt', size, type), Buffer.alloc(512, 'x'), Buffer.alloc(1024)]);
            const put = agent_tar_put({dir: path.join(to, 'in')});
            const what = (type === 'x') ? 'a pax header' : '"a.txt"';
            await assert.rejects(tar_send(put, tarred, 512), v => (v.code === 'ETARHEADER') && (v.message === `the tar is broken: the size of ${what} is not a whole number of bytes`), `${JSON.stringify(size)} in a header of type ${type}`);
            put.destroy();
        }
    }
    await new Promise(v => setTimeout(v, 20));
    assert.deepStrictEqual(names_under(to), ['in']);
});

// What GNU tar writes when asked for pax, and of a file dated before 1970, a time no header
// has digits for: base-256 below zero in its own format, a minus in pax
test('a tar in pax format unpacks as GNU\'s own does, and a file dated before 1970 lands whole, at the start of 1970', async function (t) {
    const from = dir_make(t);
    const long = `${'d'.repeat(120)}/${'f'.repeat(130)}.txt`;
    fs.mkdirSync(path.join(from, path.dirname(long)));
    fs.writeFileSync(path.join(from, long), 'long');
    fs.writeFileSync(path.join(from, 'имя файла.txt'), 'not in ascii');
    fs.writeFileSync(path.join(from, 'big.bin'), Buffer.alloc(300000, 7));
    fs.writeFileSync(path.join(from, 'run.sh'), 'run', {mode: 0o755});
    fs.writeFileSync(path.join(from, 'old.txt'), 'old');
    fs.writeFileSync(path.join(from, 'now.txt'), 'now');
    fs.utimesSync(path.join(from, 'old.txt'), new Date(-315619200000), new Date(-315619200000));
    fs.utimesSync(path.join(from, 'now.txt'), 1600000000.5, 1600000000.5);
    for (const format of ['gnu', 'pax']) {
        const to = path.join(dir_make(t), 'in');
        const tarred = child_process.execFileSync('tar', [`--format=${format}`, '-C', from, '-cf', '-', '.'], {maxBuffer: 16*1024*1024});
        assert.deepStrictEqual(await tar_send(agent_tar_put({dir: to}), tarred, 1 + Math.floor(Math.random()*700)), {path: to, files: 6, bytes: 300025}, format);
        for (const name of [long, 'имя файла.txt', 'big.bin', 'run.sh', 'old.txt', 'now.txt']) {
            assert.ok(fs.readFileSync(path.join(to, name)).equals(fs.readFileSync(path.join(from, name))), `${format}: ${name}`);
        }
        assert.strictEqual(fs.statSync(path.join(to, 'run.sh')).mode & 0o111, 0o111, format);
        assert.deepStrictEqual(['old.txt', 'now.txt'].map(v => Math.floor(fs.statSync(path.join(to, v)).mtimeMs/1000)), [0, 1600000000], format);
    }
});

// A file of a tar goes to a part this agent makes. A link somebody planted under that name
// would carry the bytes to wherever it points, so what waits there is cleared and the part is
// made new: for a token kept within the folder and for the owner alike
test('a tar writes through no link planted at a part name: to a file, to a folder, to nowhere', async function (t) {
    const from = dir_make(t);
    const names = ['file', 'folder', 'nowhere', 'sub/deep', 'stale'];
    fs.mkdirSync(path.join(from, 'sub'));
    for (const name of names) {
        fs.writeFileSync(path.join(from, name), `the bytes of ${name}`);
    }
    for (const rooted of [true, false]) {
        const to = dir_make(t);
        const away = dir_make(t);
        const victim = path.join(away, 'victim.txt');
        fs.writeFileSync(victim, 'untouched');
        fs.mkdirSync(path.join(away, 'kept'));
        fs.mkdirSync(path.join(to, 'sub'));
        fs.symlinkSync(victim, path.join(to, '.file.part'));
        fs.symlinkSync(path.join(away, 'kept'), path.join(to, '.folder.part'));
        fs.symlinkSync(path.join(away, 'made'), path.join(to, '.nowhere.part'));
        fs.symlinkSync(victim, path.join(to, 'sub', '.deep.part'));
        // No plant, only what a tar leaves when the agent is stopped in the middle of a file:
        // the same file sent again is not held up by it
        fs.writeFileSync(path.join(to, '.stale.part'), 'half of an older file, longer than the new one');
        for (const name of names) {
            const tarred = child_process.execFileSync('tar', ['-C', from, '-cf', '-', name]);
            const said = await tar_send(agent_tar_put({dir: to, root: rooted ? to : undefined}), tarred, 4096);
            assert.deepStrictEqual(said, {path: to, files: 1, bytes: `the bytes of ${name}`.length}, name);
            assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'untouched', `after ${name}, with a root: ${rooted}`);
            assert.ok(fs.lstatSync(path.join(to, name)).isFile(), `${name} is a file of its own, not the link that was under its part name`);
            assert.strictEqual(fs.readFileSync(path.join(to, name), 'utf8'), `the bytes of ${name}`);
        }
        assert.deepStrictEqual(names_under(to), ['file', 'folder', 'nowhere', 'stale', 'sub', 'sub/deep']);
        assert.deepStrictEqual(names_under(away), ['kept', 'victim.txt']);
    }
});

// A folder is not a part somebody left, and is not cleared: the tar ends at that file with the
// folder's name, and the drop the tunnel does after an error has no part of this tar to remove
test('a folder at a part name refuses the file by name, and the drop after it throws nothing', async function (t) {
    const from = dir_make(t);
    const to = dir_make(t);
    fs.writeFileSync(path.join(from, 'a.txt'), 'first');
    fs.writeFileSync(path.join(from, 'x'), 'never');
    fs.mkdirSync(path.join(to, '.x.part'));
    fs.writeFileSync(path.join(to, '.x.part', 'theirs.txt'), 'kept');
    const tarred = child_process.execFileSync('tar', ['-C', from, '-cf', '-', 'a.txt', 'x']);
    const unheld = unheld_watch(t);
    const put = agent_tar_put({dir: to});
    await assert.rejects(tar_send(put, tarred, 4096), /EISDIR.*\.x\.part/);
    put.destroy();
    await new Promise(v => setTimeout(v, 20));
    assert.deepStrictEqual(unheld, []);
    assert.deepStrictEqual(names_under(to), ['.x.part', '.x.part/theirs.txt', 'a.txt']);
    assert.strictEqual(fs.readFileSync(path.join(to, 'a.txt'), 'utf8'), 'first');
});

// The last step too: what is put under the part name while the file comes is not what is given
// the file's run bits, its name and its time. Through a link they would land on the file it
// points at; a folder would take the file's name, and is not this tar's to remove.
test('a link or a folder put at a part name while its file comes is not given the file\'s mode, name or time', async function (t) {
    const from = dir_make(t);
    const victim = path.join(dir_make(t), 'victim.txt');
    fs.writeFileSync(victim, 'untouched', {mode: 0o600});
    fs.utimesSync(victim, 1400000000, 1400000000);
    fs.writeFileSync(path.join(from, 'run.sh'), Buffer.alloc(200000, 1), {mode: 0o755});
    const tarred = child_process.execFileSync('tar', ['-C', from, '-cf', '-', 'run.sh']);
    const unheld = unheld_watch(t);
    for (const put_there of ['a link', 'a folder']) {
        const to = dir_make(t);
        const part = path.join(to, '.run.sh.part');
        const put = agent_tar_put({dir: to});
        for (let at = 0; at < 100000; at += 1000) {
            await new Promise(v => put.write(tarred.subarray(at, at + 1000), v));
        }
        fs.rmSync(part);
        if (put_there === 'a link') {
            fs.symlinkSync(victim, part);
        }
        else {
            fs.mkdirSync(part);
        }
        const failure = await new Promise(function (resolve) {
            put.on('error', resolve);
            put.write(tarred.subarray(100000), () => resolve(null));
        });
        assert.deepStrictEqual([fs.readFileSync(victim, 'utf8'), fs.statSync(victim).mode & 0o7777, fs.statSync(victim).mtimeMs], ['untouched', 0o600, 1400000000000]);
        assert.match(String(failure), /\.run\.sh\.part is not the file that was written/, put_there);
        put.destroy();
        await new Promise(v => setTimeout(v, 20));
        assert.deepStrictEqual(names_under(to), (put_there === 'a link') ? [] : ['.run.sh.part'], put_there);
    }
    assert.deepStrictEqual(unheld, []);
});

// A name of the tar that is a link, or passes through one, lands where a single upload of it
// lands (agent_file_put). Out of a token's folders it is refused by name and the tar ends
// there: the files before it are whole, the ones after it are not written.
test('a name that is a link, or passes through one, is refused out of a token\'s folders and followed for the owner', async function (t) {
    const from = dir_make(t);
    const away = dir_make(t);
    fs.mkdirSync(path.join(from, 'door'));
    fs.mkdirSync(path.join(from, 'gone-dir'));
    for (const name of ['a.txt', 'link.txt', 'to-dir', 'gone.txt', 'door/new.txt', 'gone-dir/new.txt', 'z.txt']) {
        fs.writeFileSync(path.join(from, name), `the bytes of ${name}`);
    }
    fs.mkdirSync(path.join(away, 'kept'));
    fs.writeFileSync(path.join(away, 'victim.txt'), 'untouched');
    // A folder with a link under every name: to a file, to a folder and to nowhere, all outside
    function planted() {
        const to = dir_make(t);
        fs.symlinkSync(path.join(away, 'victim.txt'), path.join(to, 'link.txt'));
        fs.symlinkSync(path.join(away, 'kept'), path.join(to, 'to-dir'));
        fs.symlinkSync(path.join(away, 'made.txt'), path.join(to, 'gone.txt'));
        fs.symlinkSync(path.join(away, 'kept'), path.join(to, 'door'));
        fs.symlinkSync(path.join(away, 'made'), path.join(to, 'gone-dir'));
        return to;
    }

    for (const name of ['link.txt', 'to-dir', 'gone.txt', 'door/new.txt', 'gone-dir/new.txt']) {
        const to = planted();
        const tarred = child_process.execFileSync('tar', ['-C', from, '-cf', '-', 'a.txt', name, 'z.txt']);
        const refused = JSON.stringify(path.join(to, name));
        await assert.rejects(tar_send(agent_tar_put({dir: to, root: to}), tarred, 4096), v => (v.code === 'EACCES') && v.message.includes(refused), name);
        assert.deepStrictEqual(names_under(to), ['a.txt', 'door', 'gone-dir', 'gone.txt', 'link.txt', 'to-dir'], name);
        assert.strictEqual(fs.readFileSync(path.join(to, 'a.txt'), 'utf8'), 'the bytes of a.txt');
        assert.deepStrictEqual(names_under(away), ['kept', 'victim.txt'], name);
        assert.strictEqual(fs.readFileSync(path.join(away, 'victim.txt'), 'utf8'), 'untouched', name);
    }

    // The owner is kept within nothing, and the link is theirs: it stays a link and the bytes
    // land in the file it points at, as an edit saved from the page does. A link to nowhere is
    // no file to write over: the file takes its name, and nothing is made where it pointed.
    const to = planted();
    const tarred = child_process.execFileSync('tar', ['-C', from, '-cf', '-', 'link.txt', 'gone.txt']);
    assert.deepStrictEqual(await tar_send(agent_tar_put({dir: to}), tarred, 4096), {path: to, files: 2, bytes: 42});
    assert.ok(fs.lstatSync(path.join(to, 'link.txt')).isSymbolicLink());
    assert.strictEqual(fs.readFileSync(path.join(away, 'victim.txt'), 'utf8'), 'the bytes of link.txt');
    assert.ok(fs.lstatSync(path.join(to, 'gone.txt')).isFile());
    assert.deepStrictEqual(names_under(away), ['kept', 'victim.txt']);
});

// One ustar header, of a file unless `type` says another, by hand: GNU tar will not write a
// name like these, nor a size that is text, which goes into its field as it is
function header_of(name, size, type)
{
    const out = Buffer.alloc(512);
    out.write(name, 0);
    out.write('0000644\0', 100);
    out.write((typeof size === 'number') ? `${size.toString(8).padStart(11, '0')}\0` : size, 124);
    out.write((type === undefined) ? '0' : type, 156);
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

// What failed in nobody's hands while the test ran: a promise like that stops the agent
function unheld_watch(t)
{
    const out = [];
    function heard(error) {
        out.push(error.message);
    }
    process.on('unhandledRejection', heard);
    t.after(() => process.off('unhandledRejection', heard));
    return out;
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
