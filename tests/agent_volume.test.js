const agent_volume = require('../src/agent/src/agent_volume');
const agent_volume_link_safe = require('../src/agent/src/agent_volume_link_safe');
const assert = require('assert');
const test = require('node:test');

const KEY = 'k3y-0f-the-client-32-bytes-long!';
const GB = 1024**3;

// A machine as far as agent_volume asks it: files, folders, mounts and the commands it ran
function fake_machine(over)
{
    const machine = {
        files: {},
        metas: {},
        folders: {'/home/user': []},
        mounts: {},
        devices: [],
        ran: [],
        inputs: [],
        disk_free: 100*GB,
        users: [],
        listable: [],
        fail: null,
        no_cryptsetup: false,
    };
    machine.system = {
        run: async function (argv, input) {
            machine.ran.push(argv.join(' '));
            machine.inputs.push((input === undefined) ? null : input);
            if (argv[1] === '--version') {
                return {code: machine.no_cryptsetup ? -1 : 0, stdout: 'cryptsetup 2.7.0', stderr: ''};
            }
            if ((machine.fail !== null) && argv.join(' ').startsWith(machine.fail)) {
                return {code: 1, stdout: '', stderr: `${argv[0]}: it went wrong`};
            }
            if ((argv[0] === 'cryptsetup') && (argv[1] === 'open')) {
                if (input !== KEY) {
                    return {code: 2, stdout: '', stderr: 'No key available with this passphrase.'};
                }
                if (argv.includes('--test-passphrase') === false) {
                    machine.devices.push(`/dev/mapper/${argv[argv.length - 1]}`);
                }
            }
            if ((argv[0] === 'cryptsetup') && (argv[1] === 'close')) {
                machine.devices = machine.devices.filter(v => v !== `/dev/mapper/${argv[2]}`);
            }
            if ((argv[0] === 'cryptsetup') && (argv[1] === 'status')) {
                return {code: 0, stdout: `/dev/mapper/${argv[2]} is active.\n  type:    LUKS2\n  device:  /dev/loop7\n`, stderr: ''};
            }
            if (argv[0] === 'mount') {
                machine.mounts[argv[4]] = argv[3];
                machine.folders[argv[4]] = ['lost+found'];
            }
            if (argv[0] === 'umount') {
                delete machine.mounts[argv[1]];
                machine.folders[argv[1]] = [];
            }
            return {code: 0, stdout: '', stderr: ''};
        },
        meta_names: async () => Object.keys(machine.metas).map(v => v.split('/').pop().replace(/\.json$/, '')).sort(),
        meta_read: async v => (machine.metas[v] === undefined) ? null : machine.metas[v],
        meta_write: async function (file, value) {
            machine.metas[file] = value;
        },
        file_stat: async v => (machine.files[v] === undefined) ? null : {size: machine.files[v], on_disk: 300*1024**2},
        file_remove: async function (file) {
            delete machine.files[file];
            delete machine.metas[file];
        },
        folder_listable: async function (dir) {
            machine.listable.push(dir);
        },
        free_of: async () => machine.disk_free,
        room_of: async () => ({used: GB, free: 9*GB}),
        mounted: async (target, device) => (machine.mounts[target] === device),
        exists: async v => machine.devices.includes(v),
        folder_names: async v => (machine.folders[v] === undefined) ? null : machine.folders[v],
        folder_make: async function (dir) {
            if (machine.folders[dir] === undefined) {
                machine.folders[dir] = [];
            }
        },
        folder_rename: async function (from, to) {
            machine.folders[to] = machine.folders[from];
            delete machine.folders[from];
        },
        folder_remove: async function (dir) {
            delete machine.folders[dir];
        },
        image_make: async function (dir, file, size) {
            machine.files[file] = size;
        },
        image_grow: async function (file, size) {
            machine.files[file] = size;
        },
        user_of: async v => (v === 'user') ? {name: 'user', uid: 1000, gid: 1000, home: '/home/user'} : null,
        users_of: async () => machine.users,
    };
    return Object.assign(machine, over);
}

function ask(machine, params)
{
    return agent_volume({volumes_dir: '/var/lib/serviceman/volumes'}, params, undefined, machine.system);
}

const CREATE = {action: 'create', name: 'projects', owner: 'user', target: '/home/user/projects', size: '20G', key: KEY};

test('create: a sparse file, LUKS2, ext4 owned by the owner, mounted at the target; the key only on stdin', async function () {
    const machine = fake_machine();
    const answer = await ask(machine, CREATE);
    assert.strictEqual(answer.ok, true);
    assert.strictEqual(answer.state, 'open');
    assert.strictEqual(answer.size, 20*GB);
    assert.strictEqual(answer.plain_left, null);
    assert.deepStrictEqual(machine.ran, [
        'cryptsetup --version',
        'cryptsetup luksFormat --type luks2 --batch-mode --pbkdf pbkdf2 --pbkdf-force-iterations 1000 --key-file=- /var/lib/serviceman/volumes/projects.img',
        'cryptsetup open --type luks2 --disable-keyring --allow-discards --key-file=- /var/lib/serviceman/volumes/projects.img serviceman-vol-projects',
        'mkfs.ext4 -q -m 0 -E root_owner=1000:1000 /dev/mapper/serviceman-vol-projects',
        'mount -o discard,nosuid,nodev /dev/mapper/serviceman-vol-projects /home/user/projects',
    ]);
    assert.ok(machine.ran.every(v => v.includes(KEY) === false), 'never in argv');
    assert.deepStrictEqual(machine.inputs.map(v => (v === KEY)), [false, true, true, false, false]);
    assert.deepStrictEqual(machine.metas['/var/lib/serviceman/volumes/projects.json'].target, '/home/user/projects');
});

test('create with a passphrase a person typed: argon2id at cryptsetup\'s own cost, not the fewest rounds', async function () {
    const machine = fake_machine();
    const answer = await ask(machine, Object.assign({}, CREATE, {passphrase: true}));
    assert.strictEqual(answer.ok, true);
    assert.strictEqual(machine.ran[1], 'cryptsetup luksFormat --type luks2 --batch-mode --pbkdf argon2id --key-file=- /var/lib/serviceman/volumes/projects.img');
    assert.strictEqual(answer.passphrase, true);
    assert.strictEqual((await ask(fake_machine(), CREATE)).passphrase, undefined);
});

test('create with plain_remove: the plain files are copied in, then their plain copy goes', async function () {
    const machine = fake_machine();
    machine.folders['/home/user/projects'] = ['repos', 'agents'];
    const answer = await ask(machine, Object.assign({}, CREATE, {plain_remove: true}));
    assert.strictEqual(answer.plain_left, null);
    const copied = machine.ran.findIndex(v => v.startsWith('cp -a /home/user/projects.plain-'));
    assert.ok(copied !== -1);
    assert.match(machine.ran[copied + 1], /^rm -rf --one-file-system \/home\/user\/projects\.plain-\d{8}T\d{6}$/);
});

test('the list names what holds each open volume, and a closed one has nobody', async function () {
    const machine = fake_machine();
    await ask(machine, CREATE);
    machine.users = [{pid: 4242, how: 'cwd', user: 'user', command: 'bash'}];
    const open = await ask(machine, {action: 'list'});
    assert.deepStrictEqual(open.items.map(v => [v.state, v.users.map(vv => vv.pid)]), [['open', [4242]]]);
    machine.users = [];
    await ask(machine, {action: 'close', name: 'projects'});
    machine.users = [{pid: 4242, how: 'cwd', user: 'user', command: 'bash'}];
    const closed = await ask(machine, {action: 'list'});
    assert.deepStrictEqual(closed.items.map(v => [v.state, v.users]), [['closed', []]]);
});

test('create over a folder with plain files: they are copied in, the plain folder kept beside it', async function () {
    const machine = fake_machine();
    machine.folders['/home/user/projects'] = ['repos', 'agents'];
    const answer = await ask(machine, CREATE);
    assert.match(answer.plain_left, /^\/home\/user\/projects\.plain-\d{8}T\d{6}$/);
    assert.deepStrictEqual(machine.folders[answer.plain_left], ['repos', 'agents']);
    assert.strictEqual(machine.ran[machine.ran.length - 1], `cp -a ${answer.plain_left}/. /home/user/projects/`);
});

test('create that fails half way leaves nothing behind, and the plain folder where it was', async function () {
    const machine = fake_machine({fail: 'mkfs.ext4'});
    machine.folders['/home/user/projects'] = ['repos'];
    await assert.rejects(ask(machine, CREATE), /mkfs\.ext4 -q failed: mkfs\.ext4: it went wrong/);
    assert.deepStrictEqual(machine.files, {});
    assert.deepStrictEqual(machine.metas, {});
    assert.deepStrictEqual(machine.devices, []);
    assert.deepStrictEqual(machine.folders['/home/user/projects'], ['repos']);
    assert.strictEqual(Object.keys(machine.folders).some(v => v.includes('.plain-')), false);
});

test('create refuses what it cannot do: a bad name, a target outside the home, a size above the free space, a second one', async function () {
    const machine = fake_machine({disk_free: 10*GB});
    const cases = [
        [{name: '../etc'}, 400, /up to 40 small letters/],
        [{owner: 'nobody-here'}, 400, /no user called "nobody-here"/],
        [{target: '/etc/projects'}, 400, /inside \/home\/user/],
        [{target: '/home/user'}, 400, /inside \/home\/user/],
        [{target: '/home/user/../root/x'}, 400, /full path/],
        [{size: '1M'}, 400, /at least 64 MB/],
        [{size: 'lots'}, 400, /a size is bytes/],
        [{key: 'short'}, 400, /16 to 4096/],
        [{size: '20G'}, 409, /more than the 10 GB free/],
    ];
    for (const [over, status, said] of cases) {
        const answer = await ask(machine, Object.assign({}, CREATE, over));
        assert.strictEqual(answer.ok, false, JSON.stringify(over));
        assert.strictEqual(answer.status, status, JSON.stringify(over));
        assert.match(answer.error, said);
    }
    assert.ok(machine.ran.every(v => v === 'cryptsetup --version'), 'nothing was run for any of them');
    const bare = fake_machine({no_cryptsetup: true});
    const missing = await ask(bare, CREATE);
    assert.deepStrictEqual([missing.status, missing.error], [501, 'cryptsetup is not on this machine: sudo apt-get install cryptsetup-bin']);
    assert.deepStrictEqual(bare.files, {});
    await ask(machine, Object.assign({}, CREATE, {size: '1G'}));
    const twice = await ask(machine, Object.assign({}, CREATE, {size: '1G'}));
    assert.deepStrictEqual([twice.status, twice.error], [409, 'there is a volume called "projects" already']);
});

test('close, then open with the key: closed waits, a wrong key is a 403 open or closed, open twice is already', async function () {
    const machine = fake_machine();
    await ask(machine, CREATE);
    const closed = await ask(machine, {action: 'close', name: 'projects'});
    assert.deepStrictEqual([closed.ok, closed.state], [true, 'closed']);
    machine.listable = [];
    const list = await ask(machine, {action: 'list'});
    assert.deepStrictEqual(list.items.map(v => [v.name, v.state, v.used]), [['projects', 'closed', null]]);
    assert.deepStrictEqual(machine.listable, ['/var/lib/serviceman', '/var/lib/serviceman/volumes'], 'its owner may list the files through the link');
    const wrong = await ask(machine, {action: 'open', name: 'projects', key: 'not-the-key-at-all!!'});
    assert.deepStrictEqual([wrong.status, wrong.code, wrong.error], [403, 'wrong_key', 'the key does not open "projects"']);
    const opened = await ask(machine, {action: 'open', name: 'projects', key: KEY});
    assert.deepStrictEqual([opened.state, opened.already, opened.used], ['open', false, GB]);
    const again = await ask(machine, {action: 'open', name: 'projects', key: KEY});
    assert.strictEqual(again.already, true);
    const wrong_again = await ask(machine, {action: 'open', name: 'projects', key: 'not-the-key-at-all!!'});
    assert.deepStrictEqual([wrong_again.status, wrong_again.code, wrong_again.error], [403, 'wrong_key', 'the key does not open "projects"']);
    const unknown = await ask(machine, {action: 'open', name: 'nothing', key: KEY});
    assert.deepStrictEqual([unknown.status, unknown.error], [404, 'there is no volume called "nothing"']);
});

test('open refuses to hide files that are in the folder while it is closed', async function () {
    const machine = fake_machine();
    await ask(machine, CREATE);
    await ask(machine, {action: 'close', name: 'projects'});
    machine.folders['/home/user/projects'] = ['written-while-closed.txt'];
    const answer = await ask(machine, {action: 'open', name: 'projects', key: KEY});
    assert.strictEqual(answer.status, 409);
    assert.match(answer.error, /has files of its own \(written-while-closed\.txt\)/);
});

test('close is refused while a process or a container holds the volume, and says who', async function () {
    const machine = fake_machine();
    await ask(machine, CREATE);
    machine.users = [{pid: 4242, how: 'a container holds it', user: 'user', command: 'conmon'}];
    const answer = await ask(machine, {action: 'close', name: 'projects'});
    assert.deepStrictEqual([answer.ok, answer.status, answer.error], [false, 409, '"projects" is in use']);
    assert.deepStrictEqual(answer.users, machine.users);
    assert.strictEqual(machine.ran.some(v => v.startsWith('umount')), false);
});

test('delete: only a closed one; its file, its json and its empty folder go', async function () {
    const machine = fake_machine();
    await ask(machine, CREATE);
    const open = await ask(machine, {action: 'delete', name: 'projects'});
    assert.deepStrictEqual([open.ok, open.status, open.error], [false, 409, '"projects" is open; close it first']);
    assert.strictEqual(machine.files['/var/lib/serviceman/volumes/projects.img'], 20*GB, 'nothing went');
    await ask(machine, {action: 'close', name: 'projects'});
    const deleted = await ask(machine, {action: 'delete', name: 'projects'});
    assert.deepStrictEqual(deleted, {ok: true, name: 'projects', owner: 'user', target: '/home/user/projects', target_left: null});
    assert.deepStrictEqual([machine.files, machine.metas], [{}, {}]);
    assert.strictEqual(machine.folders['/home/user/projects'], undefined);
    assert.deepStrictEqual((await ask(machine, {action: 'list'})).items, []);
    const again = await ask(machine, {action: 'delete', name: 'projects'});
    assert.deepStrictEqual([again.status, again.error], [404, 'there is no volume called "projects"']);
});

test('delete keeps a folder that got files while the volume was closed, and says so', async function () {
    const machine = fake_machine();
    await ask(machine, CREATE);
    await ask(machine, {action: 'close', name: 'projects'});
    machine.folders['/home/user/projects'] = ['written-while-closed.txt'];
    const deleted = await ask(machine, {action: 'delete', name: 'projects'});
    assert.strictEqual(deleted.target_left, '/home/user/projects');
    assert.deepStrictEqual(machine.folders['/home/user/projects'], ['written-while-closed.txt']);
});

test('delete refuses a volume still mapped though not mounted', async function () {
    const machine = fake_machine();
    await ask(machine, CREATE);
    delete machine.mounts['/home/user/projects'];
    const answer = await ask(machine, {action: 'delete', name: 'projects'});
    assert.strictEqual(answer.status, 409);
    assert.ok(machine.files['/var/lib/serviceman/volumes/projects.img'] !== undefined);
});

test('volumes kept elsewhere open only their own folder, never its parent', async function () {
    const machine = fake_machine();
    await agent_volume({volumes_dir: '/root/volumes'}, {action: 'list'}, undefined, machine.system);
    assert.deepStrictEqual(machine.listable, ['/root/volumes']);
});

test('grow while open: the file, the loop device, the mapping and ext4, with no key', async function () {
    const machine = fake_machine();
    await ask(machine, CREATE);
    machine.ran = [];
    machine.inputs = [];
    const answer = await ask(machine, {action: 'grow', name: 'projects', size: '40G'});
    assert.deepStrictEqual([answer.ok, answer.size], [true, 40*GB]);
    assert.deepStrictEqual(machine.ran, [
        'cryptsetup status serviceman-vol-projects',
        'losetup -c /dev/loop7',
        'cryptsetup resize serviceman-vol-projects',
        'resize2fs /dev/mapper/serviceman-vol-projects',
    ]);
    assert.ok(machine.inputs.every(v => v === null));
    const smaller = await ask(machine, {action: 'grow', name: 'projects', size: '10G'});
    assert.deepStrictEqual([smaller.status, smaller.error], [400, '"projects" is 40 GB already; a volume only grows']);
    await ask(machine, {action: 'close', name: 'projects'});
    const closed = await ask(machine, {action: 'grow', name: 'projects', size: '80G'});
    assert.deepStrictEqual([closed.status, closed.error], [409, '"projects" grows only while it is open']);
});

test('a key travels only over TLS, a socket file, this machine or the tailnet', function () {
    const cases = [
        ['https://serviceman.example.com', true],
        ['unix:///run/serviceman.sock', true],
        ['http://localhost:8081', true],
        ['http://127.0.0.1:3000', true],
        ['http://[::1]:3000', true],
        ['http://100.64.0.21:3000', true],
        ['http://serviceman.tail1234.ts.net:3000', true],
        ['http://serviceman.example.com', false],
        ['http://203.0.113.7:3000', false],
        ['http://100.200.0.1:3000', false],
        ['not a url', false],
    ];
    for (const [url, safe] of cases) {
        assert.strictEqual(agent_volume_link_safe(url), safe, url);
    }
});

test('a bare name is judged by the address its link reached: MagicDNS gives the tailnet', function () {
    const cases = [
        ['http://serviceman:3001', '100.64.0.20', true],
        ['http://serviceman:3001', '::ffff:100.64.0.20', true],
        ['http://serviceman:3001', 'fd7a:115c:a1e0::21', true],
        ['http://serviceman:3001', '127.0.0.1', true],
        ['http://serviceman:3001', '203.0.113.7', false],
        ['http://serviceman:3001', '192.0.2.6', false],
        ['http://serviceman:3001', undefined, false],
        ['http://serviceman.example.com', '100.200.0.1', false],
    ];
    for (const [url, address, safe] of cases) {
        assert.strictEqual(agent_volume_link_safe(url, address), safe, `${url} at ${address}`);
    }
});
