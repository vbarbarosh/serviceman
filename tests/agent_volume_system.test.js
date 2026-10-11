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
