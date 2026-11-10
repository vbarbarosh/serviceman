const agent_volume_system = require('../src/agent/src/agent_volume_system');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const TARGET = '/home/user/volume-try';
const DEVICE = '/dev/mapper/serviceman-vol-try';

test('a systemd service\'s copy of the mount holds nothing: it goes with the unmount', async function (t) {
    const proc = fake_proc(t, [
        {pid: 2317, comm: 'NetworkManager', ns: 'mnt:[2]', mounts: [`${TARGET} master:1137 - ext4 ${DEVICE}`]},
    ]);
    assert.deepStrictEqual(await agent_volume_system.users_of(TARGET, DEVICE, proc), []);
});

test('a container that bound the folder holds it, and is named', async function (t) {
    const proc = fake_proc(t, [
        {pid: 4000, comm: 'conmon', ns: 'mnt:[3]', mounts: [`/data - ext4 ${DEVICE}`]},
    ]);
    assert.deepStrictEqual(await agent_volume_system.users_of(TARGET, DEVICE, proc), [{pid: 4000, how: 'a container holds it', user: 'root', command: 'conmon'}]);
});

test('a copy that is a slave of another peer group holds it', async function (t) {
    const proc = fake_proc(t, [
        {pid: 4100, comm: 'sh', ns: 'mnt:[4]', mounts: [`${TARGET} master:99 - ext4 ${DEVICE}`]},
    ]);
    assert.strictEqual((await agent_volume_system.users_of(TARGET, DEVICE, proc)).length, 1);
});

test('a process with its folder in the volume holds it, whatever its namespace', async function (t) {
    const proc = fake_proc(t, [
        {pid: 5000, comm: 'bash', ns: 'mnt:[1]', cwd: `${TARGET}/notes`, mounts: []},
        {pid: 2317, comm: 'NetworkManager', ns: 'mnt:[2]', mounts: [`${TARGET} master:1137 - ext4 ${DEVICE}`]},
    ]);
    assert.deepStrictEqual(await agent_volume_system.users_of(TARGET, DEVICE, proc), [{pid: 5000, how: 'cwd', user: 'root', command: 'bash'}]);
});

test('the folder work is done to the folder itself: through a link nothing is listed, made, handed over, renamed or removed', async function (t) {
    const world = fake_home(t);
    const uid = process.getuid();
    const gid = process.getgid();
    // A link on the way, as one put there after the path was looked at
    const linked = path.join(world.home, 'l', 'kept');
    await assert.rejects(agent_volume_system.folder_names(linked), /usr-local\/kept, not as itself: nothing is done to it$/);
    await assert.rejects(agent_volume_system.folder_make(path.join(linked, 'sbin'), uid, gid), /usr-local\/kept, not as itself/);
    await assert.rejects(agent_volume_system.folder_rename(path.join(linked, 'empty'), path.join(linked, 'empty.plain-1')), /not as itself/);
    await assert.rejects(agent_volume_system.folder_remove(path.join(linked, 'empty')), /not as itself/);
    // A link under the folder's own name, or under its parent's
    await assert.rejects(agent_volume_system.folder_names(path.join(world.home, 'l')), {code: 'ENOTDIR'});
    await assert.rejects(agent_volume_system.folder_make(path.join(world.home, 'l'), uid, gid), {code: 'ENOTDIR'});
    await assert.rejects(agent_volume_system.folder_make(path.join(world.home, 'l', 'sbin'), uid, gid), {code: 'ENOTDIR'});
    await assert.rejects(agent_volume_system.folder_remove(path.join(world.home, 'l', 'kept')), {code: 'ENOTDIR'});
    assert.deepStrictEqual(fs.readdirSync(world.outside), ['kept'], 'the folder outside is as it was');
    assert.deepStrictEqual(fs.readdirSync(path.join(world.outside, 'kept')).sort(), ['empty', 'file']);
    // A plain folder, as before
    const plain = path.join(world.home, 'plain');
    assert.strictEqual(await agent_volume_system.folder_names(plain), null);
    await agent_volume_system.folder_make(plain, uid, gid);
    await agent_volume_system.folder_make(plain, uid, gid);
    assert.strictEqual(fs.statSync(plain).mode & 0o777, 0o700);
    assert.deepStrictEqual(await agent_volume_system.folder_names(plain), []);
    await agent_volume_system.folder_rename(plain, `${plain}.plain-1`);
    assert.deepStrictEqual(fs.readdirSync(world.home).sort(), ['l', 'plain.plain-1']);
    await agent_volume_system.folder_remove(`${plain}.plain-1`);
    assert.deepStrictEqual(fs.readdirSync(world.home), ['l']);
});

test('a command given a folder acts on the folder that was looked at, though its path is a link by the time it runs', async function (t) {
    const world = fake_home(t);
    const target = path.join(world.home, 'target');
    fs.mkdirSync(target);
    // As mount is given its folder: held open from before the command starts
    const running = agent_volume_system.run(['sh', '-c', 'sleep 0.3; echo in > "$0"/landed', target], undefined, [target]);
    fs.renameSync(target, path.join(world.home, 'target.moved'));
    fs.symlinkSync(world.outside, target);
    assert.strictEqual((await running).code, 0);
    assert.strictEqual(fs.existsSync(path.join(world.home, 'target.moved', 'landed')), true);
    assert.strictEqual(fs.existsSync(path.join(world.outside, 'landed')), false, 'nothing was written through the link');
    // The folder is said by its number's own dot: mount's newer calls follow no link under a last name
    const moved = path.join(world.home, 'target.moved');
    assert.strictEqual((await agent_volume_system.run(['sh', '-c', 'echo "$0" "$1"', moved, `${moved}/in`], undefined, [moved])).stdout, '/proc/self/fd/3/. /proc/self/fd/3/in\n');
    // A folder that is a link already is not given to a command at all
    await assert.rejects(agent_volume_system.run(['touch', path.join(target, 'x')], undefined, [target]), {code: 'ENOTDIR'});
    await assert.rejects(agent_volume_system.run(['touch', path.join(world.home, 'l', 'kept', 'x')], undefined, [path.join(world.home, 'l', 'kept')]), /not as itself/);
    assert.deepStrictEqual(fs.readdirSync(path.join(world.outside, 'kept')).sort(), ['empty', 'file']);
});

test('cp and rm, given their folders held, copy the plain files in and remove the plain copy as before', async function (t) {
    const world = fake_home(t);
    const plain = path.join(world.home, 'projects.plain-1');
    const target = path.join(world.home, 'projects');
    fs.mkdirSync(path.join(plain, 'repos'), {recursive: true});
    fs.writeFileSync(path.join(plain, '.hidden'), 'kept\n');
    fs.mkdirSync(target);
    const copied = await agent_volume_system.run(['cp', '-a', `${plain}/.`, `${target}/`], undefined, [plain, target]);
    assert.deepStrictEqual([copied.code, copied.stderr], [0, '']);
    assert.deepStrictEqual(fs.readdirSync(target).sort(), ['.hidden', 'repos']);
    const removed = await agent_volume_system.run(['rm', '-rf', '--one-file-system', plain], undefined, [path.dirname(plain)]);
    assert.deepStrictEqual([removed.code, removed.stderr], [0, '']);
    assert.deepStrictEqual(fs.readdirSync(world.home).sort(), ['l', 'projects']);
});

// A home with a link in it, l, to a folder that is not the owner's; in that one a folder with
// a file and an empty folder in it
function fake_home(t)
{
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agent-volume-home-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const out = {home: path.join(root, 'home'), outside: path.join(root, 'usr-local')};
    fs.mkdirSync(out.home);
    fs.mkdirSync(path.join(out.outside, 'kept', 'empty'), {recursive: true});
    fs.writeFileSync(path.join(out.outside, 'kept', 'file'), 'kept\n');
    fs.symlinkSync(out.outside, path.join(out.home, 'l'));
    return out;
}

// A /proc of our own: self is the agent, its mount shared in peer group 1137, as on phone
function fake_proc(t, processes)
{
    const proc = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-volume-proc-'));
    t.after(() => fs.rmSync(proc, {recursive: true, force: true}));
    const self = {pid: 'self', comm: 'node', ns: 'mnt:[1]', mounts: [`${TARGET} shared:1137 - ext4 ${DEVICE}`]};
    for (const item of [self].concat(processes)) {
        const base = path.join(proc, String(item.pid));
        fs.mkdirSync(path.join(base, 'ns'), {recursive: true});
        fs.mkdirSync(path.join(base, 'fd'));
        fs.symlinkSync(item.ns, path.join(base, 'ns', 'mnt'));
        fs.symlinkSync((item.cwd === undefined) ? '/' : item.cwd, path.join(base, 'cwd'));
        fs.symlinkSync('/', path.join(base, 'root'));
        fs.writeFileSync(path.join(base, 'comm'), `${item.comm}\n`);
        fs.writeFileSync(path.join(base, 'status'), 'Uid:\t0\t0\t0\t0\n');
        fs.writeFileSync(path.join(base, 'mountinfo'), item.mounts.map(v => `36 35 252:3 / ${v.replace(' ', ' rw,relatime ')} rw\n`).join(''));
    }
    return proc;
}
