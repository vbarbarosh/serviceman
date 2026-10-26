const agent_volume_system = require('./agent_volume_system');
const agent_volumes_dir = require('./agent_volumes_dir');
const path = require('path');
const reason_from_answer = require('../../helpers/reason_from_answer');

const ACTIONS = ['list', 'create', 'open', 'close', 'grow', 'delete'];
const RE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RE_OWNER = /^[a-z_][a-z0-9_-]{0,31}$/;
const RE_SIZE = /^(\d+)([KMGT]?)$/i;
const SIZE_UNITS = {'': 1, K: 1024, M: 1024**2, G: 1024**3, T: 1024**4};
const SIZE_MIN = 64*1024**2;
const KEY_MIN = 16;
const KEY_MAX = 4096;
// A random key needs no slow hash, so pbkdf2 at its fewest rounds costs nothing; argon2 wants
// up to 1 GB at every open on a small machine. A passphrase a person typed is guessable, so it
// gets argon2id at the cost cryptsetup measures on the machine
const PBKDF = ['--pbkdf', 'pbkdf2', '--pbkdf-force-iterations', '1000'];
const PBKDF_PASSPHRASE = ['--pbkdf', 'argon2id'];
const MOUNT_OPTIONS = 'discard,nosuid,nodev';

// Encrypted volumes of one machine: LUKS in a file under `dir`, opened at a folder of its
// owner. Done by the root half. The key comes in params and goes to cryptsetup on stdin only.
// A refusal is a value, {ok: false, status, error}, since only a message crosses the link.
//
//     params = {action: 'open', name: 'projects', key: '…'}
//     params = {action: 'create', name, owner, target, size, key, passphrase: true, plain_remove: true}
async function agent_volume(options, params, say, system)
{
    const ctx = {
        dir: agent_volumes_dir(options),
        say: ((say === undefined) || (say === null)) ? function () {} : say,
        system: (system === undefined) ? agent_volume_system : system,
    };
    const action = String(params.action || '');
    try {
        if (ACTIONS.includes(action) === false) {
            throw refusal(400, `a volume is asked only for ${ACTIONS.join(', ')}`);
        }
        if (action === 'list') {
            return await volume_list(ctx);
        }
        if (action === 'create') {
            return await volume_create(ctx, params);
        }
        const meta = await meta_read(ctx, name_checked(params.name));
        if (action === 'open') {
            return await volume_open(ctx, meta, key_checked(params.key));
        }
        if (action === 'close') {
            return await volume_close(ctx, meta);
        }
        if (action === 'delete') {
            return await volume_delete(ctx, meta);
        }
        return await volume_grow(ctx, meta, size_checked(params.size));
    }
    catch (error) {
        if (error.status === undefined) {
            throw error;
        }
        return Object.assign({ok: false, status: error.status, error: error.message}, error.extra);
    }
}

// Every volume of this machine, each as it stands now
async function volume_list(ctx)
{
    // The default place's parent is serviceman's own, and before 1.6.0 it was made 0700, which
    // left the link leading nowhere; a folder set elsewhere keeps its parent as it is
    if (ctx.dir === agent_volumes_dir()) {
        await ctx.system.folder_listable(path.dirname(ctx.dir));
    }
    await ctx.system.folder_listable(ctx.dir);
    const names = await ctx.system.meta_names(ctx.dir);
    const items = [];
    for (const name of names) {
        items.push(await volume_state(ctx, await meta_read(ctx, name)));
    }
    return {ok: true, items, disk_free: await ctx.system.free_of(ctx.dir)};
}

async function volume_state(ctx, meta)
{
    const files = paths_of(ctx, meta.name);
    const file = await ctx.system.file_stat(files.image);
    if (file === null) {
        return Object.assign({}, meta, {state: 'missing', users: [], size: null, on_disk: null, used: null, free: null});
    }
    const mounted = await ctx.system.mounted(meta.target, files.device);
    const room = mounted ? await ctx.system.room_of(meta.target) : null;
    return Object.assign({}, meta, {
        state: mounted ? 'open' : 'closed',
        // What holds it open now: a process in it, or a container that has it mounted
        users: mounted ? await ctx.system.users_of(meta.target, files.device) : [],
        size: file.size,
        on_disk: file.on_disk,
        used: (room === null) ? null : room.used,
        free: (room === null) ? null : room.free,
    });
}

// POST volumes {name, owner, target, size, key}
// The file, formatted and opened at the target, owned by the owner. Plain files already in the
// target are copied in; the plain folder is kept beside it, renamed, for its owner to delete.
async function volume_create(ctx, params)
{
    const name = name_checked(params.name);
    const owner = await owner_checked(ctx, params.owner);
    const target = target_checked(params.target, owner);
    const size = size_checked(params.size);
    const key = key_checked(params.key);
    const files = paths_of(ctx, name);
    if ((await ctx.system.meta_names(ctx.dir)).includes(name) || (await ctx.system.file_stat(files.image)) !== null) {
        throw refusal(409, `there is a volume called "${name}" already`);
    }
    const taken = (await volume_list(ctx)).items.find(v => v.target === target);
    if (taken !== undefined) {
        throw refusal(409, `${target} is the folder of the volume "${taken.name}" already`);
    }
    if ((await ctx.system.run(['cryptsetup', '--version'])).code !== 0) {
        throw refusal(501, 'cryptsetup is not on this machine: sudo apt-get install cryptsetup-bin');
    }
    const disk_free = await ctx.system.free_of(ctx.dir);
    if (size > disk_free) {
        throw refusal(409, `${size_text(size)} is more than the ${size_text(disk_free)} free on this machine's disk`);
    }
    const plain = await plain_move(ctx, target, owner);
    let made = false;
    try {
        ctx.say('stdout', `making ${files.image}, ${size_text(size)}`);
        await ctx.system.image_make(ctx.dir, files.image, size);
        made = true;
        ctx.say('stdout', 'formatting it with LUKS2');
        const pbkdf = (params.passphrase === true) ? PBKDF_PASSPHRASE : PBKDF;
        await run_checked(ctx, ['cryptsetup', 'luksFormat', '--type', 'luks2', '--batch-mode'].concat(pbkdf, ['--key-file=-', files.image]), key);
        await mapper_open(ctx, files, key);
        ctx.say('stdout', 'making an ext4 file system inside');
        await run_checked(ctx, ['mkfs.ext4', '-q', '-m', '0', '-E', `root_owner=${owner.uid}:${owner.gid}`, files.device]);
        await folder_mount(ctx, target, owner, files);
        const meta = {name, owner: owner.name, target, created: new Date().toISOString()};
        // A volume a person opens with what they typed, and not with a client's key
        if (params.passphrase === true) {
            meta.passphrase = true;
        }
        await ctx.system.meta_write(files.meta, meta);
    }
    catch (error) {
        await undo_create(ctx, target, files, made, plain);
        throw error;
    }
    let plain_left = plain;
    if (plain !== null) {
        ctx.say('stdout', `copying the plain files in from ${plain}`);
        await run_checked(ctx, ['cp', '-a', `${plain}/.`, `${target}/`]);
        // Asked for by a client that moves them in once: the plain copy goes after a whole copy
        if (params.plain_remove === true) {
            ctx.say('stdout', `removing the plain copy ${plain}`);
            await run_checked(ctx, ['rm', '-rf', '--one-file-system', plain]);
            plain_left = null;
        }
    }
    return Object.assign({ok: true, plain_left}, await volume_state(ctx, await meta_read(ctx, name)));
}

// POST volumes/<name>/open {key}
async function volume_open(ctx, meta, key)
{
    const files = paths_of(ctx, meta.name);
    if ((await ctx.system.file_stat(files.image)) === null) {
        throw refusal(409, `the file of "${meta.name}" is gone: ${files.image}`);
    }
    if (await ctx.system.mounted(meta.target, files.device)) {
        await key_test(ctx, files, key);
        return Object.assign({ok: true, already: true}, await volume_state(ctx, meta));
    }
    const owner = await owner_checked(ctx, meta.owner);
    const inside = await ctx.system.folder_names(meta.target);
    if ((inside !== null) && (inside.length > 0)) {
        throw refusal(409, `${meta.target} has files of its own (${inside.slice(0, 3).join(', ')}); the volume opened over them would hide them`);
    }
    if (await ctx.system.exists(files.device)) {
        await key_test(ctx, files, key);
    }
    else {
        await mapper_open(ctx, files, key);
    }
    await folder_mount(ctx, meta.target, owner, files);
    return Object.assign({ok: true, already: false}, await volume_state(ctx, meta));
}

// POST volumes/<name>/close
// Refused while anything holds it: a process in it, or a container that has it mounted
async function volume_close(ctx, meta)
{
    const files = paths_of(ctx, meta.name);
    const mounted = await ctx.system.mounted(meta.target, files.device);
    const mapped = await ctx.system.exists(files.device);
    if ((mounted === false) && (mapped === false)) {
        return Object.assign({ok: true, already: true}, await volume_state(ctx, meta));
    }
    const users = await ctx.system.users_of(meta.target, files.device);
    if (users.length > 0) {
        throw refusal(409, `"${meta.name}" is in use`, {users});
    }
    if (mounted) {
        await run_checked(ctx, ['umount', meta.target]);
    }
    await run_checked(ctx, ['cryptsetup', 'close', files.mapper]);
    return Object.assign({ok: true, already: false}, await volume_state(ctx, meta));
}

// POST volumes/<name>/delete
// Only a closed one: its file and what it knows of it go, for good. Its folder goes only when
// empty; files written into it while it was closed are its owner's
async function volume_delete(ctx, meta)
{
    const files = paths_of(ctx, meta.name);
    if ((await ctx.system.mounted(meta.target, files.device)) || (await ctx.system.exists(files.device))) {
        throw refusal(409, `"${meta.name}" is open; close it first`);
    }
    ctx.say('stdout', `deleting ${files.image}`);
    await ctx.system.file_remove(files.image);
    await ctx.system.file_remove(files.meta);
    const inside = await ctx.system.folder_names(meta.target);
    if ((inside !== null) && (inside.length === 0)) {
        await ctx.system.folder_remove(meta.target);
    }
    const target_left = ((inside === null) || (inside.length === 0)) ? null : meta.target;
    return {ok: true, name: meta.name, owner: meta.owner, target: meta.target, target_left};
}

// POST volumes/<name>/grow {size}
// While open, with nothing stopped: the file, the loop device, the mapping, the file system
async function volume_grow(ctx, meta, size)
{
    const files = paths_of(ctx, meta.name);
    if ((await ctx.system.mounted(meta.target, files.device)) === false) {
        throw refusal(409, `"${meta.name}" grows only while it is open`);
    }
    const file = await ctx.system.file_stat(files.image);
    if (size <= file.size) {
        throw refusal(400, `"${meta.name}" is ${size_text(file.size)} already; a volume only grows`);
    }
    const disk_free = await ctx.system.free_of(ctx.dir);
    if ((size - file.size) > disk_free) {
        throw refusal(409, `${size_text(size - file.size)} more is more than the ${size_text(disk_free)} free on this machine's disk`);
    }
    const status = await run_checked(ctx, ['cryptsetup', 'status', files.mapper]);
    const loop = /^\s*device:\s+(\/dev\/loop\d+)\s*$/m.exec(status.stdout);
    if (loop === null) {
        throw new Error(`cryptsetup did not say which loop device holds "${meta.name}"`);
    }
    ctx.say('stdout', `growing ${files.image} to ${size_text(size)}`);
    await ctx.system.image_grow(files.image, size);
    await run_checked(ctx, ['losetup', '-c', loop[1]]);
    await run_checked(ctx, ['cryptsetup', 'resize', files.mapper]);
    await run_checked(ctx, ['resize2fs', files.device]);
    return Object.assign({ok: true}, await volume_state(ctx, meta));
}

// The keyring is left out so that resize needs no key later
async function mapper_open(ctx, files, key)
{
    ctx.say('stdout', `opening it as ${files.device}`);
    const answer = await ctx.system.run(['cryptsetup', 'open', '--type', 'luks2', '--disable-keyring', '--allow-discards', '--key-file=-', files.image, files.mapper], key);
    if (answer.code === 2) {
        throw refusal(403, `the key does not open "${path.basename(files.image, '.img')}"`, {code: 'wrong_key'});
    }
    command_throw(['cryptsetup', 'open'], answer);
}

// A volume opened already still answers only to its key: the key is tried, nothing is opened
async function key_test(ctx, files, key)
{
    const answer = await ctx.system.run(['cryptsetup', 'open', '--type', 'luks2', '--test-passphrase', '--key-file=-', files.image], key);
    if (answer.code === 2) {
        throw refusal(403, `the key does not open "${path.basename(files.image, '.img')}"`, {code: 'wrong_key'});
    }
    command_throw(['cryptsetup', 'open', '--test-passphrase'], answer);
}

async function folder_mount(ctx, target, owner, files)
{
    await ctx.system.folder_make(target, owner.uid, owner.gid);
    ctx.say('stdout', `mounting it at ${target}`);
    await run_checked(ctx, ['mount', '-o', MOUNT_OPTIONS, files.device, target]);
}

// A target that holds files is renamed aside, so the volume can open over an empty folder
async function plain_move(ctx, target, owner)
{
    const inside = await ctx.system.folder_names(target);
    if ((inside === null) || (inside.length === 0)) {
        return null;
    }
    const out = `${target}.plain-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
    ctx.say('stdout', `moving the plain files aside: ${out}`);
    await ctx.system.folder_rename(target, out);
    await ctx.system.folder_make(target, owner.uid, owner.gid);
    return out;
}

async function undo_create(ctx, target, files, made, plain)
{
    if (await ctx.system.mounted(target, files.device)) {
        await ctx.system.run(['umount', target]);
    }
    if (await ctx.system.exists(files.device)) {
        await ctx.system.run(['cryptsetup', 'close', files.mapper]);
    }
    if (made) {
        await ctx.system.file_remove(files.image);
    }
    if (plain !== null) {
        await ctx.system.folder_remove(target);
        await ctx.system.folder_rename(plain, target);
    }
}

async function meta_read(ctx, name)
{
    const out = await ctx.system.meta_read(paths_of(ctx, name).meta);
    if (out === null) {
        throw refusal(404, `there is no volume called "${name}"`);
    }
    return out;
}

function paths_of(ctx, name)
{
    const mapper = `serviceman-vol-${name}`;
    return {
        image: path.join(ctx.dir, `${name}.img`),
        meta: path.join(ctx.dir, `${name}.json`),
        mapper,
        device: `/dev/mapper/${mapper}`,
    };
}

function name_checked(value)
{
    const out = String((value === undefined) ? '' : value);
    if (RE_NAME.test(out) === false) {
        throw refusal(400, 'a volume\'s name is up to 40 small letters, digits and hyphens');
    }
    return out;
}

async function owner_checked(ctx, value)
{
    const name = String((value === undefined) ? '' : value);
    if (RE_OWNER.test(name) === false) {
        throw refusal(400, 'an owner is a user of this machine, by name');
    }
    const out = await ctx.system.user_of(name);
    if (out === null) {
        throw refusal(400, `this machine has no user called "${name}"`);
    }
    return out;
}

// A folder inside the owner's home, written in full: the owner's home itself is not one
function target_checked(value, owner)
{
    const out = String((value === undefined) ? '' : value);
    if ((path.isAbsolute(out) === false) || (path.normalize(out) !== out) || out.endsWith('/')) {
        throw refusal(400, 'a target is a full path, like /home/user/projects');
    }
    if (out.startsWith(`${owner.home}/`) === false) {
        throw refusal(400, `a target is a folder inside ${owner.home}, the home of ${owner.name}`);
    }
    return out;
}

// Bytes, or a number with K, M, G or T
function size_checked(value)
{
    const found = RE_SIZE.exec(String((value === undefined) ? '' : value).trim());
    const out = (found === null) ? NaN : parseInt(found[1], 10)*SIZE_UNITS[found[2].toUpperCase()];
    if ((Number.isSafeInteger(out) === false) || (out < SIZE_MIN)) {
        throw refusal(400, `a size is bytes, or a number with K, M, G or T, of at least ${size_text(SIZE_MIN)}`);
    }
    return out;
}

function key_checked(value)
{
    if ((typeof value !== 'string') || (value.length < KEY_MIN) || (value.length > KEY_MAX)) {
        throw refusal(400, `a key is a string of ${KEY_MIN} to ${KEY_MAX} characters`);
    }
    return value;
}

async function run_checked(ctx, argv, input)
{
    const out = await ctx.system.run(argv, input);
    command_throw(argv, out);
    return out;
}

function command_throw(argv, answer)
{
    if (answer.code === 0) {
        return;
    }
    const said = reason_from_answer(answer);
    throw new Error(`${argv.slice(0, 2).join(' ')} failed: ${(said === null) ? `ended with ${answer.code}` : said}`);
}

function size_text(bytes)
{
    for (const unit of ['T', 'G', 'M', 'K']) {
        if (bytes >= SIZE_UNITS[unit]) {
            return `${Math.round(bytes/SIZE_UNITS[unit]*10)/10} ${unit}B`;
        }
    }
    return `${bytes} B`;
}

function refusal(status, message, extra)
{
    const out = new Error(message);
    out.status = status;
    out.extra = (extra === undefined) ? {} : extra;
    return out;
}

module.exports = agent_volume;
