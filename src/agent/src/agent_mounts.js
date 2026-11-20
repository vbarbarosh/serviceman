const agent_shared_system = require('./agent_shared_system');
const path = require('path');
const reason_from_answer = require('../../helpers/reason_from_answer');

const ACTIONS = ['status', 'apply', 'keep'];
const FUSE_TYPE = 'fuse.sshfs';
const LABEL_MAX = 100;
// No mount goes over the system's own folders, as no shared folder does (agent_shared)
const PATHS_REFUSED = ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/proc', '/run', '/sbin', '/sys', '/usr', '/var/lib/serviceman'];

// Folders of other machines mounted on this one, where the host says, read-only or read-write:
// sshfs speaks SFTP to the folder's machine, and the link carries it there in place of ssh. Done
// by the root half, which mounts over any folder of the machine and keeps them mounted. sshfs
// runs this same agent file as its "ssh": `--pipe <socket>` joins it to the socket the session
// half listens on for that mount (agent_mounts_set), and the session half opens a stream over
// its link. When the link blinks, sshfs dials the pipe again by itself (reconnect).
//
//     params = {action: 'apply', table: {mounts: [{label, path, mode: 'ro' or 'rw', socket}]}}
//     params = {action: 'keep'}       the root half's own minute
//     params = {action: 'status'}
//
// Answers {ok: true, items: [{label, path, mode, state, error}], leaving: [{label, path, users}]}.
async function agent_mounts(options, params, say, system)
{
    const dir = ((options !== undefined) && (options !== null) && (typeof options.mounts_dir === 'string') && (options.mounts_dir !== '')) ? options.mounts_dir : '/var/lib/serviceman/mounts';
    const ctx = {
        say: ((say === undefined) || (say === null)) ? function () {} : say,
        system: (system === undefined) ? agent_shared_system : system,
        files: {table: path.join(dir, 'table.json')},
        // The node and the agent file sshfs runs for its "ssh": the root half's own copies
        pipe: ((options !== undefined) && (options !== null) && Array.isArray(options.pipe_argv)) ? options.pipe_argv : [process.execPath, path.resolve(process.argv[1])],
    };
    const action = String(params.action || '');
    try {
        if (ACTIONS.includes(action) === false) {
            throw refusal(400, `mounts are asked only for ${ACTIONS.join(', ')}`);
        }
        if (action === 'status') {
            return await status_of(ctx);
        }
        if (action === 'apply') {
            const kept = await kept_read(ctx);
            kept.table = table_checked(params.table);
            await kept_write(ctx, kept);
            return await mounts_make(ctx, kept);
        }
        const kept = await kept_read(ctx);
        if ((kept.table.mounts.length === 0) && (Object.keys(kept.mounted).length === 0)) {
            return {ok: true, items: [], leaving: []};
        }
        return await mounts_make(ctx, kept);
    }
    catch (error) {
        if (error.status === undefined) {
            throw error;
        }
        return {ok: false, status: error.status, error: error.message};
    }
}

async function status_of(ctx)
{
    const kept = await kept_read(ctx);
    const items = [];
    for (const item of kept.table.mounts) {
        items.push(await mount_state(ctx, kept, item));
    }
    return {ok: true, items, leaving: await leaving_of(ctx, kept)};
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
    return {ok: true, items, leaving: await leaving_of(ctx, kept)};
}

// One mount brought to what the table says: left as it is when it already is so, mounted
// again when its mode or its socket changed and nothing holds it, or when its sshfs died;
// refused when the path is not free
async function mount_make(ctx, kept, item)
{
    const found = (await ctx.system.mounts()).find(v => v.point === item.path);
    if ((found !== undefined) && (found.type === FUSE_TYPE)) {
        const was = kept.mounted[item.path];
        const alive = await ctx.system.folder_alive(item.path);
        if (alive && (was !== undefined) && same(was, item)) {
            return await mount_state(ctx, kept, item);
        }
        if (alive) {
            const users = await ctx.system.users_of(item.path, found.source);
            if (users.length > 0) {
                return Object.assign(item_words(item), {state: 'busy', error: `${item.path} is in use; it changes once nothing holds it`, users, now: (was === undefined) ? null : was.mode});
            }
        }
        // An sshfs that died or stalls answers nothing, not even a close: it is cut off, so
        // nothing stays stuck in it, and taken off lazily
        if (alive === false) {
            await ctx.system.fuse_abort(item.path);
        }
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
    const binary = await sshfs_ensure(ctx);
    if (binary === null) {
        return Object.assign(item_words(item), {state: 'error', error: 'sshfs is not on this machine, and apt could not install it: install sshfs, it is mounted within a minute'});
    }
    await ctx.system.folder_make(item.path);
    ctx.say('stdout', `mounting ${item.label} at ${item.path}, ${(item.mode === 'ro') ? 'read-only' : 'read-write'}`);
    const answer = await ctx.system.run([binary, 'serviceman:/', item.path, '-o', sshfs_options(ctx, item)]);
    if (answer.code !== 0) {
        kept.failed[item.path] = `sshfs: ${last_line(answer)}`;
        return Object.assign(item_words(item), {state: 'error', error: kept.failed[item.path]});
    }
    delete kept.failed[item.path];
    kept.mounted[item.path] = {label: item.label, mode: item.mode, socket: item.socket};
    return await mount_state(ctx, kept, item);
}

// sshfs splits its ssh_command at spaces; the paths in it are the agent's own and the socket's,
// which have none (agent_mounts_set). Every user of the machine may open what is mounted, as
// the permissions of each file say: the folder's machine says who owns what, by number.
function sshfs_options(ctx, item)
{
    const words = [
        `ssh_command=${ctx.pipe.join(' ')} --pipe ${item.socket}`,
        'reconnect',
        'allow_other',
        'default_permissions',
        `fsname=serviceman:${item.label.replace(/[^A-Za-z0-9._-]+/g, '-')}`,
    ];
    if (item.mode === 'ro') {
        words.push('ro');
    }
    return words.join(',');
}

// sshfs, installed with apt when the machine has apt and has none; null when there is none to be had
async function sshfs_ensure(ctx)
{
    const found = await ctx.system.run(['sh', '-c', 'command -v sshfs']);
    if (found.code === 0) {
        return found.stdout.trim();
    }
    ctx.say('stdout', 'installing sshfs');
    const installed = await ctx.system.run(['apt-get', 'install', '-y', '--no-install-recommends', 'sshfs'], {env: {DEBIAN_FRONTEND: 'noninteractive'}});
    if (installed.code !== 0) {
        ctx.say('stderr', `apt-get install sshfs: ${last_line(installed)}`);
        return null;
    }
    const again = await ctx.system.run(['sh', '-c', 'command -v sshfs']);
    return (again.code === 0) ? again.stdout.trim() : null;
}

// Why a path that is not mounted cannot be: a link on the way to it, another file system on
// it, or files of its own. Asked again each time, so a path emptied since is mounted next time.
async function path_refused(ctx, item)
{
    const real = await ctx.system.path_real(item.path, '/');
    if (real.link !== null) {
        return Object.assign(item_words(item), {state: 'error', error: `${real.link} is a link to ${real.to}; a folder is mounted only at a path with no link in it`});
    }
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
    const alive = await ctx.system.folder_alive(point);
    if (alive && ((await ctx.system.users_of(point, found.source)).length > 0)) {
        return;
    }
    ctx.say('stdout', `unmounting ${point}`);
    if (alive === false) {
        await ctx.system.fuse_abort(point);
    }
    const answer = await ctx.system.run(alive ? ['umount', point] : ['umount', '-l', point]);
    if (answer.code === 0) {
        delete kept.mounted[point];
    }
}

async function mount_state(ctx, kept, item)
{
    const found = (await ctx.system.mounts()).find(v => v.point === item.path);
    const was = kept.mounted[item.path];
    if ((found === undefined) || (found.type !== FUSE_TYPE) || (was === undefined)) {
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
    if (same(was, item) === false) {
        return Object.assign(item_words(item), {state: 'busy', error: `${item.path} is in use; it changes once nothing holds it`, users: await ctx.system.users_of(item.path, found.source), now: was.mode});
    }
    return Object.assign(item_words(item), {state: 'mounted'});
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
        out.push({label: kept.mounted[point].label, path: point, users});
    }
    return out;
}

function same(was, item)
{
    return (was.mode === item.mode) && (was.socket === item.socket);
}

async function kept_read(ctx)
{
    const out = await ctx.system.json_read(ctx.files.table);
    if (out === null) {
        return {table: {mounts: []}, mounted: {}, failed: {}};
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
        throw refusal(400, 'a table is {mounts: [{label, path, mode, socket}]}');
    }
    const mounts = value.mounts.map(mount_checked);
    const points = mounts.map(v => v.path);
    if (new Set(points).size !== points.length) {
        throw refusal(400, 'two mounts of one table share a path');
    }
    const nested = points.find(v => points.some(vv => (vv !== v) && v.startsWith(`${vv}/`)));
    if (nested !== undefined) {
        throw refusal(400, `${nested} is inside another mount of the table`);
    }
    return {mounts};
}

function mount_checked(value)
{
    if ((value === null) || (typeof value !== 'object')) {
        throw refusal(400, 'a mount is {label, path, mode, socket}');
    }
    if ((value.mode !== 'rw') && (value.mode !== 'ro')) {
        throw refusal(400, 'a mount\'s mode is rw or ro');
    }
    if ((typeof value.label !== 'string') || (value.label === '') || (value.label.length > LABEL_MAX)) {
        throw refusal(400, `a mount's label is a text of at most ${LABEL_MAX} characters`);
    }
    // The session half's own socket, which the pipe dials: a full path with no space in it
    if ((typeof value.socket !== 'string') || (path.isAbsolute(value.socket) === false) || /[\s,]/.test(value.socket)) {
        throw refusal(400, 'a mount\'s socket is a full path with no space or comma in it');
    }
    return {label: value.label, path: path_checked(value.path), mode: value.mode, socket: value.socket};
}

// A full path, one level below the top at least, and none of the system's own folders
function path_checked(value)
{
    const out = String((value === undefined) ? '' : value);
    if ((path.isAbsolute(out) === false) || (path.normalize(out) !== out) || out.endsWith('/')) {
        throw refusal(400, 'a path is a full path, like /mnt/data');
    }
    if (out.split('/').length < 3) {
        throw refusal(400, `${out} is a folder of the system's own; a mount goes one level deeper, like ${(out === '/') ? '/mnt' : out}/data`);
    }
    const under = PATHS_REFUSED.find(v => (out === v) || out.startsWith(`${v}/`));
    if (under !== undefined) {
        throw refusal(400, `${out} is under ${under}, the system's own`);
    }
    return out;
}

function item_words(item)
{
    return {label: item.label, path: item.path, mode: item.mode};
}

function last_line(answer)
{
    const reason = reason_from_answer(answer);
    return (reason === null) ? `ended with ${answer.code}` : reason;
}

function refusal(status, message)
{
    const out = new Error(message);
    out.status = status;
    return out;
}

agent_mounts.PATHS_REFUSED = PATHS_REFUSED;

module.exports = agent_mounts;
