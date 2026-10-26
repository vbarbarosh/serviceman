const agent_shared = require('../src/agent/src/agent_shared');
const agent_shared_system = require('../src/agent/src/agent_shared_system');
const assert = require('assert');
const child_process = require('child_process');
const crypto = require('crypto');
const fake_shared_machine = require('./fake_shared_machine');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const DIR = '/var/lib/serviceman/shared';
const OPTIONS = {shared_dir: DIR, root_for: 'user'};
const PASSWORD = 'redisPassword0123456789abcdef';
const PASSPHRASE = 'passphrase0123456789abcdefABCD';
const META = {address: '100.64.0.20', port: 16379, password: PASSWORD};
const HOME = {
    address: '100.64.0.20',
    redis_port: 16379,
    s3_port: 13900,
    secrets: {redis_password: PASSWORD, rpc_secret: 'f'.repeat(64), access_key: `GK${'a'.repeat(24)}`, secret_key: 'b'.repeat(64), passphrase: PASSPHRASE},
};

function table_of(mounts)
{
    return {version: 'v1', meta: META, passphrase: PASSPHRASE, mounts};
}

// Every line a machine ran, with the secrets it must never show in an argv
function argv_secrets(machine)
{
    const secrets = [PASSWORD, PASSPHRASE, HOME.secrets.secret_key, HOME.secrets.rpc_secret];
    return machine.ran.filter(v => secrets.some(vv => v.argv.join(' ').includes(vv))).map(v => v.line);
}

test('a table is mounted as it says: each folder at its path, read-only where it says so, the secrets in the environment only', async function () {
    const machine = fake_shared_machine();
    const answer = await agent_shared(OPTIONS, {action: 'apply', table: table_of([{folder: 'media', path: '/srv/media', mode: 'rw'}, {folder: 'docs', path: '/srv/docs', mode: 'ro'}])}, null, machine.system);
    assert.strictEqual(answer.ok, true);
    assert.deepStrictEqual(answer.items.map(v => `${v.folder} ${v.state} ${v.read_only}`), ['media mounted false', 'docs mounted true']);
    const mounts = machine.ran.filter(v => v.argv[1] === 'mount');
    assert.deepStrictEqual(mounts.map(v => v.argv.slice(-2)), [['redis://100.64.0.20:16379/1', '/srv/media'], ['redis://100.64.0.20:16379/1', '/srv/docs']]);
    assert.ok(mounts[0].argv.includes('--subdir') && (mounts[0].argv[mounts[0].argv.indexOf('--subdir') + 1] === '/media'));
    assert.strictEqual(mounts[0].argv.includes('--read-only'), false);
    assert.ok(mounts[1].argv.includes('--read-only'));
    assert.ok(mounts[0].argv.includes('--no-usage-report'));
    assert.deepStrictEqual(mounts[0].env, {META_PASSWORD: PASSWORD, JFS_RSA_PASSPHRASE: PASSPHRASE});
    assert.deepStrictEqual(argv_secrets(machine), []);
    // juicefs came once, from its release, checked, and the archive went again
    assert.deepStrictEqual(machine.downloads, ['https://github.com/juicedata/juicefs/releases/download/v1.4.2/juicefs-1.4.2-linux-amd64.tar.gz']);
    assert.strictEqual(machine.files[`${DIR}/bin/juicefs-1.4.2`], 'the program');
    assert.strictEqual(machine.files[`${DIR}/bin/juicefs-1.4.2-linux-amd64.tar.gz`], undefined);
    // Kept for the next boot, root's alone
    const kept = JSON.parse(machine.files[`${DIR}/table.json`]);
    assert.deepStrictEqual(kept.mounted, {'/srv/media': {folder: 'media', mode: 'rw'}, '/srv/docs': {folder: 'docs', mode: 'ro'}});
    assert.strictEqual(machine.modes[`${DIR}/table.json`], 0o600);

    // The same table again changes nothing
    machine.ran = [];
    const again = await agent_shared(OPTIONS, {action: 'apply', table: table_of([{folder: 'media', path: '/srv/media', mode: 'rw'}, {folder: 'docs', path: '/srv/docs', mode: 'ro'}])}, null, machine.system);
    assert.deepStrictEqual(again.items.map(v => v.state), ['mounted', 'mounted']);
    assert.deepStrictEqual(machine.ran, []);
});

test('a path that holds files, or has another file system on it, is refused in its row; the other rows are mounted', async function () {
    const machine = fake_shared_machine();
    machine.folders['/srv/site'] = ['index.html', 'style.css'];
    machine.folders['/srv/disk'] = [];
    machine.mounts.push({point: '/srv/disk', type: 'ext4', source: '/dev/sdb1', options: ['rw']});
    const answer = await agent_shared(OPTIONS, {action: 'apply', table: table_of([{folder: 'media', path: '/srv/site', mode: 'rw'}, {folder: 'docs', path: '/srv/disk', mode: 'rw'}, {folder: 'logs', path: '/srv/logs', mode: 'ro'}])}, null, machine.system);
    assert.deepStrictEqual(answer.items.map(v => v.state), ['not_empty', 'taken', 'mounted']);
    assert.match(answer.items[0].error, /\/srv\/site has files of its own \(index\.html, style\.css\)/);
    assert.match(answer.items[1].error, /another file system on it \(ext4\)/);
    assert.deepStrictEqual(machine.folders['/srv/site'], ['index.html', 'style.css']);
});

test('a path of the system\'s own, the disk\'s root or a path that is not one is refused whole', async function () {
    const machine = fake_shared_machine();
    for (const where of ['/etc/shared', '/usr/local/media', '/', '/srv', 'srv/media', '/srv/../etc/x', '/var/lib/serviceman/shared/x']) {
        const answer = await agent_shared(OPTIONS, {action: 'apply', table: table_of([{folder: 'media', path: where, mode: 'rw'}])}, null, machine.system);
        assert.strictEqual(answer.ok, false, where);
        assert.strictEqual(answer.status, 400, where);
    }
    const bad_mode = await agent_shared(OPTIONS, {action: 'apply', table: table_of([{folder: 'media', path: '/srv/media', mode: 'rwx'}])}, null, machine.system);
    assert.strictEqual(bad_mode.status, 400);
    const twice = await agent_shared(OPTIONS, {action: 'apply', table: table_of([{folder: 'media', path: '/srv/media', mode: 'rw'}, {folder: 'docs', path: '/srv/media', mode: 'ro'}])}, null, machine.system);
    assert.match(twice.error, /share a path/);
    assert.deepStrictEqual(machine.ran, []);
});

test('a mode changed while the folder is in use waits, and changes once nothing holds it', async function () {
    const machine = fake_shared_machine();
    await agent_shared(OPTIONS, {action: 'apply', table: table_of([{folder: 'media', path: '/srv/media', mode: 'rw'}])}, null, machine.system);
    machine.users['/srv/media'] = [{pid: 4242, how: 'cwd', user: 'user', command: 'bash'}];
    const busy = await agent_shared(OPTIONS, {action: 'apply', table: table_of([{folder: 'media', path: '/srv/media', mode: 'ro'}])}, null, machine.system);
    assert.strictEqual(busy.items[0].state, 'busy');
    assert.deepStrictEqual(busy.items[0].users.map(v => v.command), ['bash']);
    assert.strictEqual(busy.items[0].now, 'rw');
    assert.strictEqual(machine.mounts[0].options[0], 'rw');
    // Asked how it stands, it still says so
    const status = await agent_shared(OPTIONS, {action: 'status'}, null, machine.system);
    assert.strictEqual(status.items[0].state, 'busy');
    machine.users['/srv/media'] = [];
    const kept = await agent_shared(OPTIONS, {action: 'keep'}, null, machine.system);
    assert.strictEqual(kept.items[0].state, 'mounted');
    assert.strictEqual(kept.items[0].read_only, true);
});

test('a mount the table no longer has is unmounted, and one held open is left until it is free', async function () {
    const machine = fake_shared_machine();
    await agent_shared(OPTIONS, {action: 'apply', table: table_of([{folder: 'media', path: '/srv/media', mode: 'rw'}, {folder: 'docs', path: '/srv/docs', mode: 'rw'}])}, null, machine.system);
    machine.users['/srv/docs'] = [{pid: 7, how: 'open file', user: 'user', command: 'vim'}];
    const answer = await agent_shared(OPTIONS, {action: 'apply', table: {version: 'v2', meta: null, passphrase: null, mounts: []}}, null, machine.system);
    assert.deepStrictEqual(answer.items, []);
    assert.deepStrictEqual(answer.leaving.map(v => `${v.path} ${v.users.map(vv => vv.command).join()}`), ['/srv/docs vim']);
    assert.deepStrictEqual(machine.mounts.map(v => v.point), ['/srv/docs']);
    // A machine with no mounts is told nothing secret, and keeps nothing secret
    const kept = JSON.parse(machine.files[`${DIR}/table.json`]);
    assert.strictEqual(kept.table.meta, null);
    assert.strictEqual(kept.table.passphrase, null);
    machine.users['/srv/docs'] = [];
    const later = await agent_shared(OPTIONS, {action: 'keep'}, null, machine.system);
    assert.deepStrictEqual(later.leaving, []);
    assert.deepStrictEqual(machine.mounts, []);
});

test('after a reboot nothing is mounted, and the minute mounts it all again; one that died is taken off and mounted anew', async function () {
    const machine = fake_shared_machine();
    await agent_shared(OPTIONS, {action: 'apply', table: table_of([{folder: 'media', path: '/srv/media', mode: 'rw'}, {folder: 'docs', path: '/srv/docs', mode: 'ro'}])}, null, machine.system);
    machine.mounts = [];
    const kept = await agent_shared(OPTIONS, {action: 'keep'}, null, machine.system);
    assert.deepStrictEqual(kept.items.map(v => v.state), ['mounted', 'mounted']);
    assert.deepStrictEqual(machine.mounts.map(v => `${v.point} ${v.options[0]}`), ['/srv/media rw', '/srv/docs ro']);
    machine.dead.push('/srv/media');
    const status = await agent_shared(OPTIONS, {action: 'status'}, null, machine.system);
    assert.strictEqual(status.items[0].state, 'error');
    machine.ran = [];
    const healed = await agent_shared(OPTIONS, {action: 'keep'}, null, machine.system);
    assert.ok(machine.ran.some(v => v.line === 'umount -l /srv/media'));
    assert.deepStrictEqual(healed.items.map(v => v.state), ['mounted', 'mounted']);
});

test('a home that is away fails the mount in its row, and the minute mounts it once the home answers', async function () {
    const machine = fake_shared_machine({mount_fails: '/srv/media'});
    const answer = await agent_shared(OPTIONS, {action: 'apply', table: table_of([{folder: 'media', path: '/srv/media', mode: 'rw'}])}, null, machine.system);
    assert.strictEqual(answer.items[0].state, 'error');
    assert.match(answer.items[0].error, /juicefs mount: connect to 100\.64\.0\.20:16379: connection refused/);
    machine.mount_fails = null;
    const kept = await agent_shared(OPTIONS, {action: 'keep'}, null, machine.system);
    assert.strictEqual(kept.items[0].state, 'mounted');
});

test('a juicefs archive whose sum is not the release\'s is not run, and nothing is mounted', async function () {
    const machine = fake_shared_machine({archive_sum: 'e'.repeat(64)});
    await assert.rejects(agent_shared(OPTIONS, {action: 'apply', table: table_of([{folder: 'media', path: '/srv/media', mode: 'rw'}])}, null, machine.system), /is not the one juicefs released: its sha256 is e{64}/);
    assert.strictEqual(machine.files[`${DIR}/bin/juicefs-1.4.2`], undefined);
    assert.strictEqual(machine.ran.some(v => v.argv[1] === 'mount'), false);
    const odd = fake_shared_machine({arch: 'riscv64'});
    const answer = await agent_shared(OPTIONS, {action: 'apply', table: table_of([{folder: 'media', path: '/srv/media', mode: 'rw'}])}, null, odd.system);
    assert.strictEqual(answer.status, 501);
});

test('the home runs Redis and Garage on its tailnet address, makes the volume once, encrypted, and mounts it whole for itself', async function () {
    const machine = fake_shared_machine();
    const answer = await agent_shared(OPTIONS, {action: 'home_up', home: HOME}, null, machine.system);
    assert.strictEqual(answer.ok, true, answer.error);
    assert.strictEqual(answer.encrypted, true);
    const redis = machine.containers['serviceman-shared-redis'].argv;
    const garage = machine.containers['serviceman-shared-garage'].argv;
    assert.ok(redis.includes('100.64.0.20:16379:6379'));
    assert.ok(garage.includes('100.64.0.20:13900:3900'));
    assert.ok(redis.includes('unless-stopped') && garage.includes('unless-stopped'));
    assert.ok(redis.includes('redis:7.4.12') && garage.includes('dxflrs/garage:v2.5.0'));
    // The keys go to Garage by name, their values through the environment
    const garage_run = machine.ran.find(v => (v.argv[1] === 'run') && v.argv.includes('serviceman-shared-garage'));
    assert.deepStrictEqual(garage_run.env, {GARAGE_DEFAULT_ACCESS_KEY: HOME.secrets.access_key, GARAGE_DEFAULT_SECRET_KEY: HOME.secrets.secret_key, GARAGE_DEFAULT_BUCKET: 'shared'});
    assert.match(machine.files[`${DIR}/home/redis/redis.conf`], new RegExp(`requirepass ${PASSWORD}`));
    assert.match(machine.files[`${DIR}/home/garage.toml`], /s3_region = "us-east-1"/);
    assert.strictEqual(machine.modes[`${DIR}/home/garage.toml`], 0o600);
    const format = machine.ran.find(v => v.argv[1] === 'format');
    assert.deepStrictEqual(format.argv.slice(2), ['--no-update', '--storage', 'minio', '--bucket', 'http://100.64.0.20:13900/shared', '--encrypt-rsa-key', `${DIR}/home/key.pem`, '--trash-days', '1', 'redis://100.64.0.20:16379/1', 'shared']);
    assert.deepStrictEqual(format.env, {META_PASSWORD: PASSWORD, JFS_RSA_PASSPHRASE: PASSPHRASE, ACCESS_KEY: HOME.secrets.access_key, SECRET_KEY: HOME.secrets.secret_key});
    assert.match(machine.format_key, /Proc-Type: 4,ENCRYPTED/);
    assert.deepStrictEqual(machine.keys, [PASSPHRASE]);
    // The key's file went the moment juicefs had read it: the key lives in Redis, locked
    assert.strictEqual(machine.files[`${DIR}/home/key.pem`], undefined);
    assert.deepStrictEqual(machine.mounts.map(v => `${v.point} ${v.subdir}`), [`${DIR}/all /`]);
    assert.deepStrictEqual(argv_secrets(machine), []);

    // Set up again, it is left as it is: the same containers, the volume not made twice
    machine.ran = [];
    const again = await agent_shared(OPTIONS, {action: 'home_up', home: HOME}, null, machine.system);
    assert.strictEqual(again.ok, true);
    assert.strictEqual(machine.ran.filter(v => ['run', 'rm', 'format'].includes(v.argv[1])).length, 0);
});

test('a home whose containers stopped has them started on the minute', async function () {
    const machine = fake_shared_machine();
    await agent_shared(OPTIONS, {action: 'home_up', home: HOME}, null, machine.system);
    machine.containers['serviceman-shared-redis'].running = false;
    await agent_shared(OPTIONS, {action: 'keep'}, null, machine.system);
    assert.strictEqual(machine.containers['serviceman-shared-redis'].running, true);
    assert.ok(machine.ran.some(v => v.line === 'docker start serviceman-shared-redis'));
});

test('a machine with no docker is refused as a home before anything is written', async function () {
    const machine = fake_shared_machine({docker: false});
    const answer = await agent_shared(OPTIONS, {action: 'home_up', home: HOME}, null, machine.system);
    assert.strictEqual(answer.status, 501);
    assert.deepStrictEqual(machine.files, {});
    const short = await agent_shared(OPTIONS, {action: 'home_up', home: Object.assign({}, HOME, {secrets: Object.assign({}, HOME.secrets, {redis_password: 'short'})})}, null, machine.system);
    assert.strictEqual(short.status, 400);
});

test('a folder is made in the whole volume, given to the agent\'s person, and deleted with juicefs rmr', async function () {
    const machine = fake_shared_machine();
    await agent_shared(OPTIONS, {action: 'home_up', home: HOME}, null, machine.system);
    const made = await agent_shared(OPTIONS, {action: 'folder_create', name: 'media', meta: META, passphrase: PASSPHRASE}, null, machine.system);
    assert.deepStrictEqual(made, {ok: true, name: 'media', already: false});
    assert.deepStrictEqual(machine.folders[`${DIR}/all`], ['media']);
    assert.deepStrictEqual(machine.given, [{dir: `${DIR}/all/media`, uid: 1000, gid: 1000}]);
    const again = await agent_shared(OPTIONS, {action: 'folder_create', name: 'media', meta: META, passphrase: PASSPHRASE}, null, machine.system);
    assert.strictEqual(again.already, true);
    const bad = await agent_shared(OPTIONS, {action: 'folder_create', name: '../etc', meta: META, passphrase: PASSPHRASE}, null, machine.system);
    assert.strictEqual(bad.status, 400);
    const gone = await agent_shared(OPTIONS, {action: 'folder_delete', name: 'media', meta: META, passphrase: PASSPHRASE}, null, machine.system);
    assert.deepStrictEqual(gone, {ok: true, name: 'media', already: false});
    assert.ok(machine.ran.some(v => v.line === `juicefs-1.4.2 rmr ${DIR}/all/media`));
    assert.deepStrictEqual(machine.folders[`${DIR}/all`], []);
});

test('an action it does not know is refused by name', async function () {
    const answer = await agent_shared(OPTIONS, {action: 'format'}, null, fake_shared_machine().system);
    assert.strictEqual(answer.status, 400);
    assert.match(answer.error, /status, apply, keep, home_up, folder_create, folder_delete/);
});

// The key the home makes is what juicefs reads: PKCS#1 under AES-256-CBC, the old PEM
// encryption Go's x509.DecryptPEMBlock takes, and it opens with the passphrase alone
test('the home\'s private key is an RSA key in the PEM form juicefs reads, opened by its passphrase only', async function (t) {
    const pem = await agent_shared_system.key_make(PASSPHRASE);
    assert.match(pem, /^-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-256-CBC,[0-9A-F]{32}\n/);
    const key = crypto.createPrivateKey({key: pem, passphrase: PASSPHRASE});
    assert.strictEqual(key.asymmetricKeyType, 'rsa');
    assert.strictEqual(key.asymmetricKeyDetails.modulusLength, 2048);
    assert.throws(() => crypto.createPrivateKey({key: pem, passphrase: 'not-the-passphrase'}));
    // And openssl, where the machine has it, reads it the same
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-key-'));
    t.after(function () {
        fs.rmSync(dir, {recursive: true, force: true});
    });
    fs.writeFileSync(path.join(dir, 'key.pem'), pem, {mode: 0o600});
    const checked = child_process.spawnSync('openssl', ['rsa', '-in', path.join(dir, 'key.pem'), '-passin', 'env:PASS', '-check', '-noout'], {env: Object.assign({}, process.env, {PASS: PASSPHRASE}), encoding: 'utf8'});
    if (checked.error === undefined) {
        assert.strictEqual(checked.status, 0, checked.stderr);
        assert.match(checked.stdout, /RSA key ok/);
    }
});
