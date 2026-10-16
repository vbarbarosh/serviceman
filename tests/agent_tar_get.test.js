const agent_file_part_finish = require('../src/agent/src/agent_file_part_finish');
const agent_link_create = require('../src/agent/src/agent_link_create');
const agent_tar_get = require('../src/agent/src/agent_tar_get');
const agent_tar_put = require('../src/agent/src/agent_tar_put');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

test('a file written while tar reads it still makes a download: exit 1 is a warning', async function () {
    const answer = await tar_with_exit(1, 'tar: logs/today.txt: file changed as we read it');
    assert.strictEqual(answer.error, null);
    assert.strictEqual(answer.bytes, 'the archive');
});

test('a folder tar cannot read is an error with what tar said last', async function () {
    const answer = await tar_with_exit(2, 'tar: secret: Cannot open: Permission denied');
    assert.strictEqual(answer.error, 'tar: secret: Cannot open: Permission denied');
});

test('names under a folder go as paths, a name like an option is a file, and none walks out', async function (t) {
    const from = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tar-from-'));
    const to = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tar-to-'));
    t.after(function () {
        fs.rmSync(from, {recursive: true, force: true});
        fs.rmSync(to, {recursive: true, force: true});
    });
    fs.mkdirSync(path.join(from, 'proj', 'src', 'deep'), {recursive: true});
    fs.mkdirSync(path.join(from, 'proj', 'empty'));
    fs.writeFileSync(path.join(from, 'proj', 'src', 'deep', 'x.js'), 'x');
    fs.writeFileSync(path.join(from, 'proj', 'src', 'left.js'), 'not asked for');
    fs.writeFileSync(path.join(from, 'proj', 'run.sh'), 'echo hi\n', {mode: 0o755});
    fs.writeFileSync(path.join(from, 'proj', '--checkpoint-action=exec=touch pwned'), 'a file');
    fs.writeFileSync(path.join(from, '-rf'), 'a file too');

    // A name that looks like one of tar's options is only a name
    const plain = await tar_read(agent_tar_get({dir: from, names: ['-rf']}));
    assert.strictEqual(plain.error, null);
    const names = ['proj/src/deep/x.js', 'proj/run.sh', 'proj/empty', 'proj/--checkpoint-action=exec=touch pwned'];
    const tarred = await tar_read(agent_tar_get({dir: from, names, paths: true}));
    assert.strictEqual(tarred.error, null);
    assert.strictEqual(fs.existsSync(path.join(from, 'proj', 'pwned')) || fs.existsSync('pwned'), false);

    // Unpacked by the agent at the other end: the files asked for and no other, run bits kept
    const put = agent_tar_put({dir: to});
    const said = await new Promise(function (resolve, reject) {
        const chunks = [];
        put.on('data', v => chunks.push(v));
        put.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
        put.on('error', reject);
        put.write(tarred.raw, function () {
            put.end();
        });
    });
    assert.strictEqual(said.files, 3);
    assert.strictEqual(fs.readFileSync(path.join(to, 'proj', 'src', 'deep', 'x.js'), 'utf8'), 'x');
    assert.strictEqual(fs.existsSync(path.join(to, 'proj', 'src', 'left.js')), false);
    assert.strictEqual(fs.statSync(path.join(to, 'proj', 'empty')).isDirectory(), true);
    assert.notStrictEqual(fs.statSync(path.join(to, 'proj', 'run.sh')).mode & 0o100, 0);
    assert.strictEqual(fs.statSync(path.join(to, 'proj', 'src', 'deep', 'x.js')).mode & 0o111, 0);

    for (const wrong of ['../etc/passwd', 'proj/../../x', '/etc/passwd', 'proj//x', 'proj/./x']) {
        assert.throws(() => agent_tar_get({dir: from, names: [wrong], paths: true}), /a name of the folder itself is wanted/, wrong);
    }
    assert.throws(() => agent_tar_get({dir: from, names: ['proj/run.sh']}), /a name of the folder itself is wanted/, 'a path only when paths are asked for');
});

test('a link is made as it was, a link there already is made already, any other name is left alone', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-link-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    assert.deepStrictEqual(await agent_link_create({path: path.join(dir, 'a', 'lib'), target: '../src'}), {created: true});
    assert.strictEqual(fs.readlinkSync(path.join(dir, 'a', 'lib')), '../src');
    assert.deepStrictEqual(await agent_link_create({path: path.join(dir, 'a', 'lib'), target: '../src'}), {created: false});
    await assert.rejects(agent_link_create({path: path.join(dir, 'a', 'lib'), target: '/etc'}), /lib is there already, and is not that link/);
    fs.writeFileSync(path.join(dir, 'file.txt'), 'mine');
    await assert.rejects(agent_link_create({path: path.join(dir, 'file.txt'), target: 'x'}), /is there already/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'file.txt'), 'utf8'), 'mine');
    await assert.rejects(agent_link_create({path: path.join(dir, 'x'), target: ''}), /its target is empty/);
});

test('a file finished from parts takes the run bits it had where it came from, when it is new', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-part-mode-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    fs.writeFileSync(path.join(dir, '.run.sh.abcdef123.part'), 'echo\n');
    await agent_file_part_finish({dir, name: 'run.sh', id: 'abcdef123', size: 5, mode: 0o755});
    assert.notStrictEqual(fs.statSync(path.join(dir, 'run.sh')).mode & 0o100, 0);
    fs.writeFileSync(path.join(dir, '.plain.txt.abcdef123.part'), 'text\n');
    await agent_file_part_finish({dir, name: 'plain.txt', id: 'abcdef123', size: 5, mode: 0o644});
    assert.strictEqual(fs.statSync(path.join(dir, 'plain.txt')).mode & 0o111, 0);
    // One there already keeps its own mode
    fs.writeFileSync(path.join(dir, 'kept.sh'), 'old', {mode: 0o600});
    fs.writeFileSync(path.join(dir, '.kept.sh.abcdef123.part'), 'new');
    await agent_file_part_finish({dir, name: 'kept.sh', id: 'abcdef123', size: 3, mode: 0o755});
    assert.strictEqual(fs.statSync(path.join(dir, 'kept.sh')).mode & 0o777, 0o600);
});

// The whole of what a tar stream gives, or why it stopped
async function tar_read(stream)
{
    const chunks = [];
    stream.on('data', v => chunks.push(v));
    const error = await new Promise(function (resolve) {
        stream.on('end', () => resolve(null));
        stream.on('error', e => resolve(e.message));
    });
    return {error, raw: Buffer.concat(chunks)};
}

// A tar of our own on PATH: it writes its bytes, says the line, and ends with the code
async function tar_with_exit(code, said)
{
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tar-'));
    fs.writeFileSync(path.join(bin, 'tar'), `#!/bin/sh\nprintf 'the archive'\necho '${said}' >&2\nexit ${code}\n`, {mode: 0o755});
    const path_before = process.env.PATH;
    process.env.PATH = `${bin}:${path_before}`;
    try {
        const stream = agent_tar_get({dir: bin, names: ['tar']});
        const chunks = [];
        stream.on('data', v => chunks.push(v));
        const error = await new Promise(function (resolve) {
            stream.on('end', () => resolve(null));
            stream.on('error', function (error) {
                resolve(error.message);
            });
        });
        return {error, bytes: Buffer.concat(chunks).toString('utf8')};
    }
    finally {
        process.env.PATH = path_before;
        fs.rmSync(bin, {recursive: true, force: true});
    }
}
