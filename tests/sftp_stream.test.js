const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sftp_client = require('./sftp_client');
const sftp_stream = require('../src/helpers/sftp_stream');
const test = require('node:test');

const {u32, str} = sftp_client;

const FX_OK = 0;
const FX_NO_SUCH_FILE = 2;
const FX_PERMISSION_DENIED = 3;
const FX_OP_UNSUPPORTED = 8;
const PFLAG_READ = 0x1;

test('a read-only folder is listed and read, and every change is refused', async function (t) {
    const {dir} = folders_make(t);
    const client = await client_open(t, dir, true);
    assert.strictEqual(await client.realpath('.'), '/');
    assert.deepStrictEqual(await client.names('/'), ['.', '..', 'in-link', 'logs', 'out-dir', 'out-link', 'serviceman.json']);
    assert.strictEqual(await client.read_file('/serviceman.json'), '{"port": 3000}\n');
    // A link that stays inside the folder is followed
    assert.strictEqual((await client.stat('/in-link')).size, 15);

    assert.strictEqual((await client.write_file('/new.txt', 'x')).code, FX_PERMISSION_DENIED);
    assert.strictEqual((await client.ask(14, [str('/made'), u32(0)])).code, FX_PERMISSION_DENIED);
    assert.strictEqual((await client.ask(13, [str('/serviceman.json')])).code, FX_PERMISSION_DENIED);
    assert.strictEqual(fs.existsSync(path.join(dir, 'new.txt')), false);
    assert.strictEqual(fs.existsSync(path.join(dir, 'serviceman.json')), true);
});

test('nothing outside the folder is reached: not by .., not through a link, not in a message', async function (t) {
    const {base, dir} = folders_make(t);
    const client = await client_open(t, dir, false);
    assert.strictEqual(await client.realpath('../..'), '/');
    // `..` stops at the folder: /../secret.txt is the folder's own secret.txt, which is not there
    assert.strictEqual((await client.open('/../secret.txt', PFLAG_READ)).code, FX_NO_SUCH_FILE);
    for (const name of ['/out-link', '/out-dir/secret.txt']) {
        const refused = await client.open(name, PFLAG_READ);
        assert.strictEqual(refused.code, FX_PERMISSION_DENIED, name);
        assert.strictEqual(refused.message.includes(base), false, refused.message);
    }
    assert.strictEqual((await client.ask(11, [str('/out-dir')])).code, FX_PERMISSION_DENIED);
    assert.strictEqual((await client.ask(17, [str('/out-link')])).code, FX_PERMISSION_DENIED);
    assert.strictEqual((await client.write_file('/out-link', 'changed')).code, FX_PERMISSION_DENIED);
    assert.strictEqual((await client.write_file('/out-dir/new.txt', 'made')).code, FX_PERMISSION_DENIED);
    // A link made over the mount could lead a program of this machine out of the folder
    assert.strictEqual((await client.ask(20, [str('/etc/passwd'), str('/made-link')])).code, FX_OP_UNSUPPORTED);
    assert.strictEqual(fs.readFileSync(path.join(base, 'secret.txt'), 'utf8'), 'outside\n');
    assert.deepStrictEqual(fs.readdirSync(base).sort(), ['data', 'secret.txt']);
    assert.strictEqual(fs.existsSync(path.join(dir, 'made-link')), false);
});

test('a read-write folder takes files, folders and renames', async function (t) {
    const {dir} = folders_make(t);
    const client = await client_open(t, dir, false);
    assert.strictEqual((await client.write_file('/new.txt', 'hello')).code, FX_OK);
    assert.strictEqual(await client.read_file('/new.txt'), 'hello');
    assert.strictEqual((await client.ask(14, [str('/made'), u32(0)])).code, FX_OK);
    assert.strictEqual((await client.ask(18, [str('/new.txt'), str('/made/new.txt')])).code, FX_OK);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'made', 'new.txt'), 'utf8'), 'hello');
    // SFTP's own rename leaves a file that is there; posix-rename takes its place
    assert.notStrictEqual((await client.ask(18, [str('/made/new.txt'), str('/serviceman.json')])).code, FX_OK);
    assert.strictEqual((await client.ask(200, [str('posix-rename@openssh.com'), str('/made/new.txt'), str('/serviceman.json')])).code, FX_OK);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'serviceman.json'), 'utf8'), 'hello');
    assert.strictEqual((await client.ask(15, [str('/made')])).code, FX_OK);
    assert.strictEqual(fs.existsSync(path.join(dir, 'made')), false);
});

test('a folder that is not there ends the stream with the reason', async function (t) {
    const {base} = folders_make(t);
    const server = sftp_stream(path.join(base, 'nope'), {read_only: true});
    const ended = new Promise(function (resolve) {
        server.on('error', resolve);
    });
    server.write(packet(1, [u32(3)]));
    assert.match((await ended).message, /^no folder /);
});

// A folder `data` with a file, a folder, a link inside it and two that lead out of it, and a
// secret beside it
function folders_make(t)
{
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-stream-'));
    t.after(function () {
        fs.rmSync(base, {recursive: true, force: true});
    });
    const dir = path.join(base, 'data');
    fs.mkdirSync(path.join(dir, 'logs'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'serviceman.json'), '{"port": 3000}\n');
    fs.writeFileSync(path.join(base, 'secret.txt'), 'outside\n');
    fs.symlinkSync('serviceman.json', path.join(dir, 'in-link'));
    fs.symlinkSync(path.join(base, 'secret.txt'), path.join(dir, 'out-link'));
    fs.symlinkSync(base, path.join(dir, 'out-dir'));
    return {base, dir};
}

async function client_open(t, dir, read_only)
{
    const server = sftp_stream(dir, {read_only});
    t.after(function () {
        server.destroy();
    });
    return await sftp_client(server);
}

function packet(type, parts)
{
    const body = Buffer.concat([Buffer.from([type])].concat(parts));
    return Buffer.concat([u32(body.length), body]);
}
