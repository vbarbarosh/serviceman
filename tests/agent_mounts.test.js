const agent_mounts = require('../src/agent/src/agent_mounts');
const assert = require('assert');
const path = require('path');
const test = require('node:test');

const OPTIONS = {mounts_dir: '/var/lib/serviceman/mounts', pipe_argv: ['/usr/local/lib/serviceman-agent/node', '/usr/local/lib/serviceman-agent/serviceman-agent.js']};
const SOCKET = '/home/user/serviceman-agent/mounts/0123456789abcdef.sock';

test('a table is mounted with sshfs dialling the pipe in place of ssh, read-only where it says so', async function () {
    const machine = machine_fake();
    const answer = await agent_mounts(OPTIONS, {action: 'apply', table: {mounts: [
        {label: 'photos', path: '/mnt/photos', mode: 'ro', socket: SOCKET},
        {label: 'notes', path: '/srv/notes', mode: 'rw', socket: '/home/user/serviceman-agent/mounts/fedcba9876543210.sock'},
    ]}}, null, machine.system);
    assert.strictEqual(answer.ok, true);
    assert.deepStrictEqual(answer.items.map(v => `${v.label} ${v.path} ${v.mode} ${v.state}`), ['photos /mnt/photos ro mounted', 'notes /srv/notes rw mounted']);
    const sshfs = machine.ran.filter(v => v[0] === '/usr/bin/sshfs');
    assert.deepStrictEqual(sshfs.map(v => v.slice(1, 3)), [['serviceman:/', '/mnt/photos'], ['serviceman:/', '/srv/notes']]);
    const options = sshfs.map(v => v[4].split(','));
    assert.strictEqual(options[0][0], `ssh_command=/usr/local/lib/serviceman-agent/node /usr/local/lib/serviceman-agent/serviceman-agent.js --pipe ${SOCKET}`);
    for (const word of ['reconnect', 'allow_other', 'default_permissions']) {
        assert.ok(options[0].includes(word) && options[1].includes(word), word);
    }
    assert.strictEqual(options[0].includes('ro'), true);
    assert.strictEqual(options[1].includes('ro'), false);

    // Asked again, nothing that is as it should be is touched
    const again = await agent_mounts(OPTIONS, {action: 'keep'}, null, machine.system);
    assert.deepStrictEqual(again.items.map(v => v.state), ['mounted', 'mounted']);
    assert.strictEqual(machine.ran.filter(v => v[0] === '/usr/bin/sshfs').length, 2);
});

test('an sshfs that died is cut off and mounted again at the next minute', async function () {
    const machine = machine_fake();
    const table = {mounts: [{label: 'photos', path: '/mnt/photos', mode: 'ro', socket: SOCKET}]};
    await agent_mounts(OPTIONS, {action: 'apply', table}, null, machine.system);
    machine.dead.push('/mnt/photos');
    const status = await agent_mounts(OPTIONS, {action: 'status'}, null, machine.system);
    assert.strictEqual(status.items[0].state, 'error');
    const kept = await agent_mounts(OPTIONS, {action: 'keep'}, null, machine.system);
    assert.strictEqual(kept.items[0].state, 'mounted');
    assert.deepStrictEqual(machine.aborted, ['/mnt/photos']);
    assert.ok(machine.ran.some(v => v.join(' ') === 'umount -l /mnt/photos'));
    assert.strictEqual(machine.ran.filter(v => v[0] === '/usr/bin/sshfs').length, 2);
});

test('a path with files of its own, or another file system on it, is not mounted over', async function () {
    const machine = machine_fake();
    machine.folders['/srv/full'] = ['keep.txt'];
    machine.mounts.push({point: '/srv/disk', type: 'ext4', source: '/dev/sdb1', options: ['rw']});
    const answer = await agent_mounts(OPTIONS, {action: 'apply', table: {mounts: [
        {label: 'a', path: '/srv/full', mode: 'ro', socket: SOCKET},
        {label: 'b', path: '/srv/disk', mode: 'ro', socket: SOCKET},
    ]}}, null, machine.system);
    assert.deepStrictEqual(answer.items.map(v => v.state), ['not_empty', 'taken']);
    assert.match(answer.items[0].error, /keep\.txt/);
    assert.strictEqual(machine.ran.some(v => v[0] === '/usr/bin/sshfs'), false);
});

test('a mount taken out of the table is unmounted, and one in use waits until it is free', async function () {
    const machine = machine_fake();
    const table = {mounts: [{label: 'photos', path: '/mnt/photos', mode: 'ro', socket: SOCKET}]};
    await agent_mounts(OPTIONS, {action: 'apply', table}, null, machine.system);
    machine.users['/mnt/photos'] = [{pid: 42, user: 'user', command: 'less', how: 'open file'}];
    const busy = await agent_mounts(OPTIONS, {action: 'apply', table: {mounts: []}}, null, machine.system);
    assert.deepStrictEqual(busy.leaving.map(v => `${v.label} ${v.path} ${v.users.length}`), ['photos /mnt/photos 1']);
    assert.strictEqual(machine.mounts.length, 1);
    machine.users['/mnt/photos'] = [];
    const free = await agent_mounts(OPTIONS, {action: 'keep'}, null, machine.system);
    assert.deepStrictEqual(free.leaving, []);
    assert.strictEqual(machine.mounts.length, 0);
});

test('with no sshfs and no apt, the row says to install it', async function () {
    const machine = machine_fake({sshfs: false, apt: false});
    const answer = await agent_mounts(OPTIONS, {action: 'apply', table: {mounts: [{label: 'photos', path: '/mnt/photos', mode: 'ro', socket: SOCKET}]}}, null, machine.system);
    assert.strictEqual(answer.items[0].state, 'error');
    assert.match(answer.items[0].error, /install sshfs/);
    const installed = machine_fake({sshfs: false, apt: true});
    const after = await agent_mounts(OPTIONS, {action: 'apply', table: {mounts: [{label: 'photos', path: '/mnt/photos', mode: 'ro', socket: SOCKET}]}}, null, installed.system);
    assert.strictEqual(after.items[0].state, 'mounted');
});

test('the system\'s own folders, a path inside another mount and a socket with a space are refused', async function () {
    for (const [item, words] of [
        [{label: 'a', path: '/etc/x', mode: 'ro', socket: SOCKET}, /under \/etc/],
        [{label: 'a', path: '/mnt', mode: 'ro', socket: SOCKET}, /one level deeper/],
        [{label: 'a', path: '/mnt/a', mode: 'ro', socket: '/home/user/my agent/x.sock'}, /no space/],
        [{label: 'a', path: '/mnt/a', mode: 'xx', socket: SOCKET}, /rw or ro/],
    ]) {
        const answer = await agent_mounts(OPTIONS, {action: 'apply', table: {mounts: [item]}}, null, machine_fake().system);
        assert.strictEqual(answer.ok, false);
        assert.match(answer.error, words);
    }
    const nested = await agent_mounts(OPTIONS, {action: 'apply', table: {mounts: [
        {label: 'a', path: '/mnt/a', mode: 'ro', socket: SOCKET},
        {label: 'b', path: '/mnt/a/b', mode: 'ro', socket: SOCKET},
    ]}}, null, machine_fake().system);
    assert.match(nested.error, /inside another mount/);
});

// A machine as far as agent_mounts asks it: folders, mounts, who holds what, whether it has
// sshfs and apt, and every command it ran
function machine_fake(over)
{
    const machine = Object.assign({files: {}, folders: {'/mnt': [], '/srv': []}, mounts: [], users: {}, dead: [], ran: [], sshfs: true, apt: true}, over);
    function answer(code, stdout, stderr) {
        return {code, stdout: (stdout === undefined) ? '' : stdout, stderr: (stderr === undefined) ? '' : stderr};
    }
    machine.system = {
        run: async function (argv) {
            machine.ran.push(argv);
            if ((argv[0] === 'sh') && (argv[2] === 'command -v sshfs')) {
                return machine.sshfs ? answer(0, '/usr/bin/sshfs\n') : answer(1);
            }
            if (argv[0] === 'apt-get') {
                if (machine.apt === false) {
                    return answer(-1, '', 'apt-get: not found');
                }
                machine.sshfs = true;
                return answer(0);
            }
            if (argv[0] === '/usr/bin/sshfs') {
                machine.mounts.push({point: argv[2], type: 'fuse.sshfs', source: 'serviceman:/', options: argv[4].split(',').includes('ro') ? ['ro'] : ['rw']});
                return answer(0);
            }
            if (argv[0] === 'umount') {
                const point = argv[argv.length - 1];
                if (((machine.users[point] || []).length > 0) && (argv.includes('-l') === false)) {
                    return answer(32, '', `umount: ${point}: target is busy.`);
                }
                machine.mounts = machine.mounts.filter(v => v.point !== point);
                machine.dead = machine.dead.filter(v => v !== point);
                return answer(0);
            }
            return answer(1, '', `${argv[0]}: not here`);
        },
        json_read: async v => (machine.files[v] === undefined) ? null : JSON.parse(machine.files[v]),
        file_write: async function (file, text) {
            machine.files[file] = text;
        },
        path_real: async v => ({path: v, link: null, to: null}),
        folder_names: async v => (machine.folders[v] === undefined) ? null : machine.folders[v].slice(),
        folder_make: async function (dir) {
            if (machine.folders[dir] === undefined) {
                machine.folders[dir] = [];
                machine.folders[path.dirname(dir)] = (machine.folders[path.dirname(dir)] || []).concat(path.basename(dir));
            }
        },
        mounts: async () => machine.mounts.slice(),
        folder_alive: async v => (machine.dead.includes(v) === false),
        fuse_abort: async function (point) {
            machine.aborted = (machine.aborted || []).concat(point);
            return true;
        },
        users_of: async v => (machine.users[v] || []),
    };
    return machine;
}
