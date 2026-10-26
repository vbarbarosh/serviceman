const agent_shared_dir = require('./agent_shared_dir');
const agent_shared_system = require('./agent_shared_system');
const crypto = require('crypto');
const path = require('path');
const reason_from_answer = require('../../helpers/reason_from_answer');

const ACTIONS = ['status', 'apply', 'keep', 'home_up', 'folder_create', 'folder_delete'];
const JUICEFS_VERSION = '1.4.2';
// The archives' sums as the release published them: a download that differs is not run
const JUICEFS_SHA256 = {
    x64: '79648a0a67145bf42ca4e8336578c13a5bbc9a0bd34df340b3b93dac1e975247',
    arm64: '19f72a30d3642a2f7971c8c4a31d2647de62f19520716e85c3a777de5f4c9036',
};
const JUICEFS_ARCHES = {x64: 'amd64', arm64: 'arm64'};
const IMAGE_REDIS = 'redis:7.4.12';
const IMAGE_GARAGE = 'dxflrs/garage:v2.5.0';
const CONTAINER_REDIS = 'serviceman-shared-redis';
const CONTAINER_GARAGE = 'serviceman-shared-garage';
// The one volume every shared folder is a part of, and the bucket that holds its bytes
const VOLUME = 'shared';
const BUCKET = 'shared';
const SOURCE = `JuiceFS:${VOLUME}`;
const FUSE_TYPE = 'fuse.juicefs';
// The read cache each machine keeps, in MiB; juicefs also leaves a tenth of the disk free
const CACHE_MIB = 10240;
const READY_TRIES = 30;
const READY_EVERY_MS = 1000;
const RE_FOLDER = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RE_SECRET = /^[A-Za-z0-9]{16,128}$/;
// No shared folder goes over the system's own folders
const PATHS_REFUSED = ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/proc', '/run', '/sbin', '/sys', '/usr', '/var/lib/serviceman'];

// Shared folders on one machine: the parts of one JuiceFS volume mounted where the host says,
// read-write or read-only; and on the machine that is their home, the Redis that holds the
// names and the Garage that holds the bytes, both encrypted before they leave a machine. Done
// by the root half. Secrets come in params and reach a command through its environment only.
// A refusal is a value, {ok: false, status, error}, since only a message crosses the link.
//
//     params = {action: 'apply', table: {version, meta: {address, port, password}, passphrase, mounts: [{folder, path, mode}]}}
//     params = {action: 'home_up', home: {address, redis_port, s3_port, secrets: {redis_password, rpc_secret, access_key, secret_key, passphrase}}}
//     params = {action: 'folder_create', name, meta, passphrase}
async function agent_shared(options, params, say, system)
{
    const dir = agent_shared_dir(options);
    const ctx = {
        dir,
        owner: ((options === undefined) || (options === null) || (typeof options.root_for !== 'string') || (options.root_for === '')) ? (process.env.SUDO_USER || '') : options.root_for,
        say: ((say === undefined) || (say === null)) ? function () {} : say,
        system: (system === undefined) ? agent_shared_system : system,
        files: {
            table: path.join(dir, 'table.json'),
            home: path.join(dir, 'home', 'home.json'),
            cache: path.join(dir, 'cache'),
            log: path.join(dir, 'juicefs.log'),
            all: path.join(dir, 'all'),
        },
    };
    const action = String(params.action || '');
    try {
        if (ACTIONS.includes(action) === false) {
            throw refusal(400, `shared folders are asked only for ${ACTIONS.join(', ')}`);
        }
        if (action === 'status') {
            return await status_of(ctx);
        }
        if (action === 'apply') {
            return await table_apply(ctx, table_checked(params.table));
        }
        if (action === 'keep') {
            return await kept_apply(ctx);
        }
        if (action === 'home_up') {
            return await home_up(ctx, home_checked(params.home));
        }
        const access = access_checked(params.meta, params.passphrase);
        if (action === 'folder_create') {
            return await folder_create(ctx, access, folder_checked(params.name));
        }
        return await folder_delete(ctx, access, folder_checked(params.name));
    }
    catch (error) {
        if (error.status === undefined) {
            throw error;
        }
        return Object.assign({ok: false, status: error.status, error: error.message}, error.extra);
    }
}

// The table as it stands here: each mount the host wants, and each it no longer wants that is
// still held open, with what holds it
async function status_of(ctx)
{
    const kept = await kept_read(ctx);
    const items = [];
    for (const item of kept.table.mounts) {
        items.push(await mount_state(ctx, kept, item));
    }
    return {ok: true, version: kept.table.version, items, leaving: await leaving_of(ctx, kept)};
}

// A new table from the host: written down first, so a reboot mounts the same, then made so
async function table_apply(ctx, table)
{
    const kept = await kept_read(ctx);
    kept.table = table;
    await kept_write(ctx, kept);
    return await mounts_make(ctx, kept);
}

// The root half's own minute: what should be mounted and is not is mounted again, a home whose
// containers stopped has them started, and nothing that is as it should be is touched
async function kept_apply(ctx)
{
    const home = await ctx.system.json_read(ctx.files.home);
    if (home !== null) {
        await containers_start(ctx);
    }
    const kept = await kept_read(ctx);
    if ((kept.table.mounts.length === 0) && (Object.keys(kept.mounted).length === 0)) {
        return {ok: true, version: kept.table.version, items: [], leaving: []};
    }
    return await mounts_make(ctx, kept);
}

async function mounts_make(ctx, kept)
{
    const table = kept.table;
    for (const point of Object.keys(kept.mounted)) {
        if (table.mounts.some(v => v.path === point) === false) {
            await mount_leave(ctx, kept, point);
        }
    }
    const items = [];
    for (const item of table.mounts) {
        items.push(await mount_make(ctx, kept, item));
    }
    for (const point of Object.keys(kept.failed)) {
        if (table.mounts.some(v => v.path === point) === false) {
            delete kept.failed[point];
        }
    }
    await kept_write(ctx, kept);
    return {ok: true, version: table.version, items, leaving: await leaving_of(ctx, kept)};
}

// One mount brought to what the table says: left as it is when it already is so, mounted again
// when its folder or mode changed and nothing holds it, refused when the path is not free
async function mount_make(ctx, kept, item)
{
    const found = (await ctx.system.mounts()).find(v => v.point === item.path);
    if ((found !== undefined) && (found.type === FUSE_TYPE)) {
        const was = kept.mounted[item.path];
        const alive = await ctx.system.folder_alive(item.path);
        if (alive && (was !== undefined) && (was.folder === item.folder) && (was.mode === item.mode)) {
            return await mount_state(ctx, kept, item);
        }
        if (alive) {
            const users = await ctx.system.users_of(item.path, found.source);
            if (users.length > 0) {
                return Object.assign(item_words(item), {state: 'busy', error: `${item.path} is in use; it changes once nothing holds it`, users, now: (was === undefined) ? null : was.mode});
            }
        }
        // A mount whose program died is taken off lazily: it answers nothing, not even a close
        const gone = await ctx.system.run(alive ? ['umount', item.path] : ['umount', '-l', item.path]);
        if (gone.code !== 0) {
            return Object.assign(item_words(item), {state: 'error', error: `umount ${item.path}: ${last_line(gone)}`});
        }
        delete kept.mounted[item.path];
    }
    const refused = await path_refused(ctx, item);
    if (refused !== null) {
        return refused;
    }
    const binary = await juicefs_ensure(ctx);
    await ctx.system.folder_make(item.path);
    ctx.say('stdout', `mounting ${item.folder} at ${item.path}, ${(item.mode === 'ro') ? 'read-only' : 'read-write'}`);
    const argv = [binary, 'mount', '-d', '--no-usage-report', '--subdir', `/${item.folder}`, '--cache-dir', ctx.files.cache, '--cache-size', String(CACHE_MIB), '--log', ctx.files.log];
    if (item.mode === 'ro') {
        argv.push('--read-only');
    }
    argv.push(meta_url(kept.table.meta), item.path);
    const answer = await ctx.system.run(argv, {env: access_env(kept.table.meta, kept.table.passphrase)});
    if (answer.code !== 0) {
        kept.failed[item.path] = `juicefs mount: ${last_line(answer)}`;
        return Object.assign(item_words(item), {state: 'error', error: kept.failed[item.path]});
    }
    delete kept.failed[item.path];
    kept.mounted[item.path] = {folder: item.folder, mode: item.mode};
    return await mount_state(ctx, kept, item);
}

// Why a path that is not mounted cannot be: another file system on it, or files of its own.
// Asked again each time, so a path emptied since is mounted at the next try.
async function path_refused(ctx, item)
{
    const found = (await ctx.system.mounts()).find(v => v.point === item.path);
    if ((found !== undefined) && (found.type !== FUSE_TYPE)) {
        return Object.assign(item_words(item), {state: 'taken', error: `${item.path} has another file system on it (${found.type})`});
    }
    const inside = await ctx.system.folder_names(item.path);
    if ((found === undefined) && (inside !== null) && (inside.length > 0)) {
        return Object.assign(item_words(item), {state: 'not_empty', error: `${item.path} has files of its own (${inside.slice(0, 3).join(', ')}); the folder mounted over them would hide them`});
    }
    return null;
}

// A mount the table no longer has: unmounted, unless something holds it, and then kept as
// leaving until a later try finds it free
async function mount_leave(ctx, kept, point)
{
    const found = (await ctx.system.mounts()).find(v => (v.point === point) && (v.type === FUSE_TYPE));
    if (found === undefined) {
        delete kept.mounted[point];
        return;
    }
    if ((await ctx.system.users_of(point, found.source)).length > 0) {
        return;
    }
    ctx.say('stdout', `unmounting ${point}`);
    const answer = await ctx.system.run(['umount', point]);
    if (answer.code === 0) {
        delete kept.mounted[point];
    }
}

async function mount_state(ctx, kept, item)
{
    const found = (await ctx.system.mounts()).find(v => v.point === item.path);
    const was = kept.mounted[item.path];
    if ((found === undefined) || (found.type !== FUSE_TYPE) || (was === undefined)) {
        // Not mounted says why, as the try to mount it said
        const refused = await path_refused(ctx, item);
        if (refused !== null) {
            return refused;
        }
        if (kept.failed[item.path] !== undefined) {
            return Object.assign(item_words(item), {state: 'error', error: kept.failed[item.path]});
        }
        return Object.assign(item_words(item), {state: 'unmounted'});
    }
    if ((await ctx.system.folder_alive(item.path)) === false) {
        return Object.assign(item_words(item), {state: 'error', error: `${item.path} stopped answering; it is mounted again within a minute`});
    }
    if ((was.folder !== item.folder) || (was.mode !== item.mode)) {
        return Object.assign(item_words(item), {state: 'busy', error: `${item.path} is in use; it changes once nothing holds it`, users: await ctx.system.users_of(item.path, found.source), now: was.mode});
    }
    const room = await ctx.system.room_of(item.path);
    return Object.assign(item_words(item), {state: 'mounted', read_only: found.options.includes('ro'), used: room.used, free: room.free});
}

async function leaving_of(ctx, kept)
{
    const out = [];
    for (const point of Object.keys(kept.mounted)) {
        if (kept.table.mounts.some(v => v.path === point)) {
            continue;
        }
        const found = (await ctx.system.mounts()).find(v => (v.point === point) && (v.type === FUSE_TYPE));
        const users = (found === undefined) ? [] : await ctx.system.users_of(point, found.source);
        out.push({folder: kept.mounted[point].folder, path: point, users});
    }
    return out;
}

// The home of the shared folders: Redis and Garage in containers docker keeps up through a
// reboot, published on the tailnet address only, then the volume made once, encrypted, and
// mounted whole where only root goes, for folders to be made and deleted in
async function home_up(ctx, home)
{
    if ((await ctx.system.run(['docker', 'version', '--format', '{{.Server.Version}}'])).code !== 0) {
        throw refusal(501, 'docker does not answer on this machine; the home runs Redis and Garage in it');
    }
    const secrets = home.secrets;
    const base = path.join(ctx.dir, 'home');
    await ctx.system.folder_make(ctx.dir, 0o700);
    await ctx.system.folder_make(path.join(base, 'redis'), 0o700);
    await ctx.system.folder_make(path.join(base, 'garage', 'meta'), 0o700);
    await ctx.system.folder_make(path.join(base, 'garage', 'data'), 0o700);
    // The image's entrypoint hands /data to its redis user, the config with it
    const redis_conf = ['appendonly yes', 'maxmemory-policy noeviction', `requirepass ${secrets.redis_password}`, ''].join('\n');
    await ctx.system.file_write(path.join(base, 'redis', 'redis.conf'), redis_conf);
    const garage_toml = [
        'metadata_dir = "/var/lib/garage/meta"',
        'data_dir = "/var/lib/garage/data"',
        'db_engine = "sqlite"',
        'replication_factor = 1',
        'rpc_bind_addr = "[::]:3901"',
        'rpc_public_addr = "127.0.0.1:3901"',
        `rpc_secret = "${secrets.rpc_secret}"`,
        '',
        '[s3_api]',
        // juicefs signs for this region unless told another
        's3_region = "us-east-1"',
        'api_bind_addr = "[::]:3900"',
        '',
    ].join('\n');
    await ctx.system.file_write(path.join(base, 'garage.toml'), garage_toml);
    const redis_argv = ['-p', `${home.address}:${home.redis_port}:6379`, '-v', `${path.join(base, 'redis')}:/data`, IMAGE_REDIS, 'redis-server', '/data/redis.conf'];
    await container_up(ctx, CONTAINER_REDIS, redis_argv, redis_conf, {});
    const garage_argv = [
        '-p', `${home.address}:${home.s3_port}:3900`,
        '-v', `${path.join(base, 'garage.toml')}:/etc/garage.toml:ro`,
        '-v', `${path.join(base, 'garage', 'meta')}:/var/lib/garage/meta`,
        '-v', `${path.join(base, 'garage', 'data')}:/var/lib/garage/data`,
        '-e', 'GARAGE_DEFAULT_ACCESS_KEY', '-e', 'GARAGE_DEFAULT_SECRET_KEY', '-e', 'GARAGE_DEFAULT_BUCKET',
        IMAGE_GARAGE, '/garage', 'server', '--single-node', '--default-bucket',
    ];
    const garage_env = {GARAGE_DEFAULT_ACCESS_KEY: secrets.access_key, GARAGE_DEFAULT_SECRET_KEY: secrets.secret_key, GARAGE_DEFAULT_BUCKET: BUCKET};
    await container_up(ctx, CONTAINER_GARAGE, garage_argv, `${garage_toml}${JSON.stringify(garage_env)}`, garage_env);
    await ready_wait(ctx, home.address, home.redis_port, 'Redis');
    await ready_wait(ctx, home.address, home.s3_port, 'Garage');
    const meta = {address: home.address, port: home.redis_port, password: secrets.redis_password};
    await ctx.system.file_write(ctx.files.home, `${JSON.stringify({address: home.address, redis_port: home.redis_port, s3_port: home.s3_port}, null, 4)}\n`);
    const binary = await juicefs_ensure(ctx);
    await volume_format(ctx, binary, home, meta);
    await all_mount(ctx, {meta, passphrase: secrets.passphrase});
    return {ok: true, address: home.address, redis_port: home.redis_port, s3_port: home.s3_port, volume: VOLUME, encrypted: true, room: await ctx.system.room_of(ctx.files.all)};
}

// One container of the home: left running when it runs as these lines say, made anew when not.
// The lines and the config are its mark, so a changed config is a new container.
async function container_up(ctx, name, argv, config, env)
{
    const mark = crypto.createHash('sha256').update(`${argv.join('\n')}\n${config}`).digest('hex').slice(0, 16);
    const inspected = await ctx.system.run(['docker', 'inspect', '--format', '{{.State.Running}} {{index .Config.Labels "serviceman.shared"}}', name]);
    if ((inspected.code === 0) && (inspected.stdout.trim() === `true ${mark}`)) {
        ctx.say('stdout', `${name} runs already`);
        return;
    }
    if (inspected.code === 0) {
        ctx.say('stdout', `${name} is made anew`);
        await run_checked(ctx, ['docker', 'rm', '-f', name]);
    }
    const image = argv.find(v => (v === IMAGE_REDIS) || (v === IMAGE_GARAGE));
    ctx.say('stdout', `pulling ${image}`);
    await run_checked(ctx, ['docker', 'pull', image]);
    ctx.say('stdout', `starting ${name}`);
    await run_checked(ctx, ['docker', 'run', '-d', '--name', name, '--restart', 'unless-stopped', '--label', `serviceman.shared=${mark}`].concat(argv), {env});
}

// The home's containers come back by themselves after a reboot, unless their address was not
// there yet when docker started them: the minute starts what stopped
async function containers_start(ctx)
{
    for (const name of [CONTAINER_REDIS, CONTAINER_GARAGE]) {
        const inspected = await ctx.system.run(['docker', 'inspect', '--format', '{{.State.Running}}', name]);
        if ((inspected.code === 0) && (inspected.stdout.trim() === 'false')) {
            ctx.say('stdout', `starting ${name} again`);
            await ctx.system.run(['docker', 'start', name]);
        }
    }
}

async function ready_wait(ctx, host, port, what)
{
    for (let i = 0; i < READY_TRIES; i++) {
        if (await ctx.system.port_open(host, port, READY_EVERY_MS)) {
            return;
        }
        await ctx.system.sleep(READY_EVERY_MS);
    }
    throw refusal(504, `${what} does not answer on ${host}:${port}; docker logs ${(what === 'Redis') ? CONTAINER_REDIS : CONTAINER_GARAGE} says why`);
}

// Made once: a volume already in Redis is the one every machine mounts, and is never made again
async function volume_format(ctx, binary, home, meta)
{
    const env = Object.assign(access_env(meta, home.secrets.passphrase), {ACCESS_KEY: home.secrets.access_key, SECRET_KEY: home.secrets.secret_key});
    const status = await ctx.system.run([binary, 'status', meta_url(meta)], {env});
    if (status.code === 0) {
        ctx.say('stdout', `the volume "${VOLUME}" is there already`);
        return;
    }
    // The key is made here and goes into Redis locked by the passphrase; the file is gone again
    // as soon as juicefs has read it
    const key_file = path.join(ctx.dir, 'home', 'key.pem');
    await ctx.system.file_write(key_file, await ctx.system.key_make(home.secrets.passphrase));
    ctx.say('stdout', `making the volume "${VOLUME}", encrypted`);
    try {
        // --no-update: a volume that is there after all is left exactly as it is, its key with it
        await run_checked(ctx, [binary, 'format', '--no-update', '--storage', 'minio', '--bucket', `http://${home.address}:${home.s3_port}/${BUCKET}`, '--encrypt-rsa-key', key_file, '--trash-days', '1', meta_url(meta), VOLUME], {env});
    }
    finally {
        await ctx.system.file_remove(key_file);
    }
}

// The whole volume, mounted on the home where only root goes: folders are made and deleted there
async function all_mount(ctx, access)
{
    const found = (await ctx.system.mounts()).find(v => (v.point === ctx.files.all) && (v.type === FUSE_TYPE));
    if ((found !== undefined) && (await ctx.system.folder_alive(ctx.files.all))) {
        return;
    }
    if (found !== undefined) {
        await ctx.system.run(['umount', '-l', ctx.files.all]);
    }
    const binary = await juicefs_ensure(ctx);
    await ctx.system.folder_make(ctx.files.all, 0o700);
    await run_checked(ctx, [binary, 'mount', '-d', '--no-usage-report', '--cache-dir', ctx.files.cache, '--cache-size', String(CACHE_MIB), '--log', ctx.files.log, meta_url(access.meta), ctx.files.all], {env: access_env(access.meta, access.passphrase)});
}

// A new shared folder: a folder of the volume, given to the person the root half serves
async function folder_create(ctx, access, name)
{
    await all_mount(ctx, access);
    const folder = path.join(ctx.files.all, name);
    if ((await ctx.system.folder_names(folder)) !== null) {
        return {ok: true, name, already: true};
    }
    await ctx.system.folder_make(folder);
    const owner = (ctx.owner === '') ? null : await ctx.system.user_of(ctx.owner);
    if (owner !== null) {
        await ctx.system.folder_give(folder, owner.uid, owner.gid);
    }
    return {ok: true, name, already: false};
}

// A folder and everything in it: juicefs keeps what it removes in its trash for a day
async function folder_delete(ctx, access, name)
{
    await all_mount(ctx, access);
    const folder = path.join(ctx.files.all, name);
    if ((await ctx.system.folder_names(folder)) === null) {
        return {ok: true, name, already: true};
    }
    ctx.say('stdout', `deleting the folder ${name}`);
    await run_checked(ctx, [await juicefs_ensure(ctx), 'rmr', folder]);
    return {ok: true, name, already: false};
}

// The juicefs program, fetched once from its release and checked against the sum it published
async function juicefs_ensure(ctx)
{
    const binary = path.join(ctx.dir, 'bin', `juicefs-${JUICEFS_VERSION}`);
    if (await ctx.system.file_exists(binary)) {
        return binary;
    }
    const arch = await ctx.system.arch();
    if (JUICEFS_ARCHES[arch] === undefined) {
        throw refusal(501, `juicefs has no release for this machine (${arch})`);
    }
    const name = `juicefs-${JUICEFS_VERSION}-linux-${JUICEFS_ARCHES[arch]}.tar.gz`;
    const archive = path.join(ctx.dir, 'bin', name);
    ctx.say('stdout', `fetching ${name}`);
    await ctx.system.download(`https://github.com/juicedata/juicefs/releases/download/v${JUICEFS_VERSION}/${name}`, archive);
    try {
        const sum = await ctx.system.sha256_of(archive);
        if (sum !== JUICEFS_SHA256[arch]) {
            throw new Error(`${name} is not the one juicefs released: its sha256 is ${sum}`);
        }
        await run_checked(ctx, ['tar', '-xzf', archive, '-C', path.dirname(archive), 'juicefs']);
        await run_checked(ctx, ['mv', path.join(path.dirname(archive), 'juicefs'), binary]);
    }
    finally {
        await ctx.system.file_remove(archive);
    }
    return binary;
}

async function kept_read(ctx)
{
    const out = await ctx.system.json_read(ctx.files.table);
    if (out === null) {
        return {table: {version: null, meta: null, passphrase: null, mounts: []}, mounted: {}, failed: {}};
    }
    // What the last try to mount each path said, kept so a later ask hears it too
    if (out.failed === undefined) {
        out.failed = {};
    }
    return out;
}

async function kept_write(ctx, kept)
{
    await ctx.system.file_write(ctx.files.table, `${JSON.stringify(kept, null, 4)}\n`);
}

function table_checked(value)
{
    if ((value === null) || (typeof value !== 'object') || (Array.isArray(value.mounts) === false)) {
        throw refusal(400, 'a table is {version, meta, passphrase, mounts}');
    }
    const mounts = value.mounts.map(mount_checked);
    const points = mounts.map(v => v.path);
    if (new Set(points).size !== points.length) {
        throw refusal(400, 'two mounts of one table share a path');
    }
    if (mounts.length === 0) {
        return {version: String(value.version || ''), meta: null, passphrase: null, mounts};
    }
    const access = access_checked(value.meta, value.passphrase);
    return {version: String(value.version || ''), meta: access.meta, passphrase: access.passphrase, mounts};
}

function mount_checked(value)
{
    if ((value === null) || (typeof value !== 'object')) {
        throw refusal(400, 'a mount is {folder, path, mode}');
    }
    if ((value.mode !== 'rw') && (value.mode !== 'ro')) {
        throw refusal(400, 'a mount\'s mode is rw or ro');
    }
    return {folder: folder_checked(value.folder), path: path_checked(value.path), mode: value.mode};
}

function access_checked(meta, passphrase)
{
    if ((meta === null) || (typeof meta !== 'object') || (typeof meta.address !== 'string') || (Number.isInteger(meta.port) === false)) {
        throw refusal(400, 'meta is {address, port, password}');
    }
    return {meta: {address: meta.address, port: meta.port, password: secret_checked(meta.password)}, passphrase: secret_checked(passphrase)};
}

function home_checked(value)
{
    if ((value === null) || (typeof value !== 'object') || (typeof value.address !== 'string') || (value.secrets === null) || (typeof value.secrets !== 'object')) {
        throw refusal(400, 'a home is {address, redis_port, s3_port, secrets}');
    }
    for (const port of [value.redis_port, value.s3_port]) {
        if ((Number.isInteger(port) === false) || (port < 1024) || (port > 65535)) {
            throw refusal(400, 'a home\'s ports are from 1024 to 65535');
        }
    }
    const secrets = {};
    for (const key of ['redis_password', 'rpc_secret', 'access_key', 'secret_key', 'passphrase']) {
        secrets[key] = secret_checked(value.secrets[key]);
    }
    return {address: value.address, redis_port: value.redis_port, s3_port: value.s3_port, secrets};
}

function secret_checked(value)
{
    if ((typeof value !== 'string') || (RE_SECRET.test(value) === false)) {
        throw refusal(400, 'a secret is 16 to 128 letters and digits');
    }
    return value;
}

function folder_checked(value)
{
    const out = String((value === undefined) ? '' : value);
    if (RE_FOLDER.test(out) === false) {
        throw refusal(400, 'a shared folder\'s name is up to 40 small letters, digits and hyphens');
    }
    return out;
}

// A full path, and none of the system's own folders or what is under them
function path_checked(value)
{
    const out = String((value === undefined) ? '' : value);
    if ((path.isAbsolute(out) === false) || (path.normalize(out) !== out) || out.endsWith('/')) {
        throw refusal(400, 'a path is a full path, like /srv/media');
    }
    if (out === '/') {
        throw refusal(400, 'the root of the disk is the system\'s own; a shared folder goes in a folder of its own, like /srv/shared');
    }
    if (out.split('/').length < 3) {
        throw refusal(400, `${out} is a folder of the system's own; a shared folder goes one level deeper, like ${out}/shared`);
    }
    const under = PATHS_REFUSED.find(v => (out === v) || out.startsWith(`${v}/`));
    if (under !== undefined) {
        throw refusal(400, `${out} is under ${under}, the system's own`);
    }
    return out;
}

function meta_url(meta)
{
    return `redis://${meta.address}:${meta.port}/1`;
}

function access_env(meta, passphrase)
{
    return {META_PASSWORD: meta.password, JFS_RSA_PASSPHRASE: passphrase};
}

function item_words(item)
{
    return {folder: item.folder, path: item.path, mode: item.mode};
}

async function run_checked(ctx, argv, options)
{
    const out = await ctx.system.run(argv, options);
    if (out.code !== 0) {
        throw new Error(`${argv.slice(0, 2).map(v => path.basename(v)).join(' ')} failed: ${last_line(out)}`);
    }
    return out;
}

function last_line(answer)
{
    const reason = reason_from_answer(answer);
    return (reason === null) ? `ended with ${answer.code}` : reason;
}

function refusal(status, message, extra)
{
    const out = new Error(message);
    out.status = status;
    out.extra = (extra === undefined) ? {} : extra;
    return out;
}

module.exports = agent_shared;
