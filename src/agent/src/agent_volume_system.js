const agent_path_real = require('./agent_path_real');
const child_process = require('child_process');
const fs = require('fs');
const mounts_read = require('./mounts_read');
const path = require('path');

const RUN_TIMEOUT_MS = 600000;
const SECTOR_BYTES = 512;
// A folder held open is named by its number: the kernel goes from there to the folder itself,
// and reads no path again. A command's own first held folder is its number 3.
const HELD_DIR = '/proc/self/fd';
const HELD_FIRST = 3;
const HELD_FLAGS = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW;

// What agent_volume asks of the machine, in one place, so its tests can give another. The
// folders in `held` are opened first, each as itself (folder_open), and the command gets them
// open, in place of their paths in its argv: what it mounts on or copies into is the folder
// that was looked at, whatever its path names by then.
async function run(argv, input, held)
{
    const folders = (held === undefined) ? [] : held;
    const fds = [];
    try {
        for (const dir of folders) {
            fds.push(folder_open(dir));
        }
    }
    catch (error) {
        fds_close(fds);
        throw error;
    }
    const words = argv.map(v => held_word(v, folders));
    return await new Promise(function (resolve) {
        const child = child_process.spawn(words[0], words.slice(1), {env: Object.assign({}, process.env, {LC_ALL: 'C'}), timeout: RUN_TIMEOUT_MS, stdio: ['pipe', 'pipe', 'pipe'].concat(fds)});
        // The command has them now, as its own
        fds_close(fds);
        const stdout = [];
        const stderr = [];
        child.stdout.on('data', v => stdout.push(v));
        child.stderr.on('data', v => stderr.push(v));
        child.on('error', function (error) {
            resolve({code: -1, stdout: '', stderr: (error.code === 'ENOENT') ? `${argv[0]}: not found` : error.message});
        });
        child.on('close', function (code) {
            resolve({code: (code === null) ? -1 : code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8')});
        });
        child.stdin.on('error', function () {
            // A command that does not read its stdin closes it; its status says the rest
        });
        child.stdin.end((input === undefined) ? '' : Buffer.from(input, 'utf8'));
    });
}

async function meta_names(dir)
{
    try {
        return fs.readdirSync(dir).filter(v => v.endsWith('.json')).map(v => v.slice(0, -'.json'.length)).sort();
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

async function meta_read(file)
{
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

async function meta_write(file, value)
{
    fs.writeFileSync(file, `${JSON.stringify(value, null, 4)}\n`, {mode: 0o600});
}

// The file's size, and what it really takes on the disk: a sparse file takes what was written
async function file_stat(file)
{
    try {
        const stat = fs.statSync(file);
        return {size: stat.size, on_disk: stat.blocks*SECTOR_BYTES};
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

async function file_remove(file)
{
    fs.rmSync(file, {force: true});
}

// The free space of the disk a folder is on, or will be on once made
async function free_of(dir)
{
    let at = dir;
    while ((fs.existsSync(at) === false) && (at !== path.dirname(at))) {
        at = path.dirname(at);
    }
    const stat = fs.statfsSync(at);
    return stat.bavail*stat.bsize;
}

async function room_of(dir)
{
    const stat = fs.statfsSync(dir);
    return {used: (stat.blocks - stat.bfree)*stat.bsize, free: stat.bavail*stat.bsize};
}

// Whether the device is mounted at the folder, as this machine's own mount table says
async function mounted(target, device)
{
    return mounts_read('/proc/self/mountinfo').some(v => (v.point === target) && (v.source === device));
}

async function exists(file)
{
    return fs.existsSync(file);
}

// Where a path leads, with no link followed below `base`: agent_path_real says it
async function path_real(given, base)
{
    return agent_path_real(given, base);
}

// What a folder holds, or null when there is no such folder
async function folder_names(dir)
{
    let fd;
    try {
        fd = folder_open(dir);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
    try {
        return fs.readdirSync(`${HELD_DIR}/${fd}`);
    }
    finally {
        fs.closeSync(fd);
    }
}

// The folder made where there is none, and given to its owner: the folder itself, never what
// a link under its name leads to
async function folder_make(dir, uid, gid)
{
    name_held(dir, function (at) {
        try {
            fs.mkdirSync(at, {mode: 0o700});
        }
        catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
        const fd = fs.openSync(at, HELD_FLAGS);
        try {
            fs.fchownSync(fd, uid, gid);
        }
        finally {
            fs.closeSync(fd);
        }
    });
}

// A folder given another name beside its own
async function folder_rename(from, to)
{
    name_held(from, v => fs.renameSync(v, path.join(path.dirname(v), path.basename(to))));
}

async function folder_remove(dir)
{
    name_held(dir, v => fs.rmdirSync(v));
}

// A folder opened as itself, and held: what is done to it next is done to this folder. A link
// under its last name is not followed, and one anywhere else on the way shows in the kernel's
// own name for what was opened, which is then not the path. Its path is the real one
// (path_real), so a link is one put there after it was looked at.
function folder_open(dir)
{
    const fd = fs.openSync(dir, HELD_FLAGS);
    const real = fs.readlinkSync(`${HELD_DIR}/${fd}`);
    if (real !== dir) {
        fs.closeSync(fd);
        throw new Error(`${dir} opens as ${real}, not as itself: nothing is done to it`);
    }
    return fd;
}

// What is done to a name in a folder, with that folder held open: the name is looked up in the
// folder itself, and mkdir, rename and rmdir follow no link under the name
function name_held(dir, fn)
{
    const fd = folder_open(path.dirname(dir));
    try {
        return fn(`${HELD_DIR}/${fd}/${path.basename(dir)}`);
    }
    finally {
        fs.closeSync(fd);
    }
}

function fds_close(fds)
{
    for (const fd of fds) {
        fs.closeSync(fd);
    }
}

// A word of a command with a held folder's path in it, said by that folder's number. The
// folder itself is its own `.`: the number alone is a link by its kind, and the newer mount
// calls follow no link under a path's last name.
function held_word(word, held)
{
    const at = held.findIndex(v => (word === v) || word.startsWith(`${v}/`));
    if (at === -1) {
        return word;
    }
    return `${HELD_DIR}/${HELD_FIRST + at}${(word === held[at]) ? '/.' : word.slice(held[at].length)}`;
}

// Its owner may list the volume files through the link in the agent's folder: names and sizes
// show, each file stays root's alone (0600)
async function folder_listable(dir)
{
    if (fs.existsSync(dir)) {
        fs.chmodSync(dir, 0o755);
    }
}

async function image_make(dir, file, size)
{
    fs.mkdirSync(dir, {recursive: true, mode: 0o755});
    const fd = fs.openSync(file, 'wx', 0o600);
    try {
        fs.ftruncateSync(fd, size);
    }
    finally {
        fs.closeSync(fd);
    }
}

async function image_grow(file, size)
{
    fs.truncateSync(file, size);
}

// A user of this machine: {name, uid, gid, home}, or null
async function user_of(name)
{
    const answer = await run(['getent', 'passwd', name]);
    const fields = answer.stdout.trim().split(':');
    if ((answer.code !== 0) || (fields.length < 7)) {
        return null;
    }
    return {name, uid: parseInt(fields[2], 10), gid: parseInt(fields[3], 10), home: fields[5]};
}

// What holds a volume: a process with its folder, a file or its root in it, and a mount
// namespace other than this one, a container's, that has the device mounted. A copy that came
// by propagation (a systemd service's sandbox: master: or shared: of this mount's peer group)
// goes away with this unmount, so it holds nothing.
async function users_of(target, device, proc = '/proc')
{
    const out = [];
    const own_ns = link_read(`${proc}/self/ns/mnt`);
    const own = mounts_read(`${proc}/self/mountinfo`).filter(v => v.source === device);
    const groups = own.flatMap(v => v.peers).filter(v => v.startsWith('shared:')).map(v => v.split(':')[1]);
    const namespaces = [];
    for (const pid of fs.readdirSync(proc).filter(v => /^\d+$/.test(v))) {
        if (Number(pid) === process.pid) {
            continue;
        }
        const base = `${proc}/${pid}`;
        const how = process_how(base, target);
        if (how !== null) {
            out.push(Object.assign({pid: Number(pid), how}, process_who(base)));
            continue;
        }
        const ns = link_read(`${base}/ns/mnt`);
        if ((ns === null) || (ns === own_ns) || namespaces.includes(ns)) {
            continue;
        }
        namespaces.push(ns);
        if (mounts_read(`${base}/mountinfo`).some(v => (v.source === device) && (mount_propagated(v, groups) === false))) {
            out.push(Object.assign({pid: Number(pid), how: 'a container holds it'}, process_who(base)));
        }
    }
    return out;
}

// Whether a mount is a peer or a slave of one of these peer groups, so that their unmount is its
function mount_propagated(mount, groups)
{
    return mount.peers.some(v => /^(shared|master):/.test(v) && groups.includes(v.split(':')[1]));
}

function process_how(base, target)
{
    function inside(file) {
        return (file !== null) && ((file === target) || file.startsWith(`${target}/`));
    }
    if (inside(link_read(`${base}/cwd`))) {
        return 'cwd';
    }
    if (inside(link_read(`${base}/root`))) {
        return 'root';
    }
    let fds = [];
    try {
        fds = fs.readdirSync(`${base}/fd`);
    }
    catch {
        return null;
    }
    return fds.some(v => inside(link_read(`${base}/fd/${v}`))) ? 'open file' : null;
}

function process_who(base)
{
    let command = '';
    let uid = null;
    try {
        command = fs.readFileSync(`${base}/comm`, 'utf8').trim();
        uid = Number(/^Uid:\s+(\d+)/m.exec(fs.readFileSync(`${base}/status`, 'utf8'))[1]);
    }
    catch {
        // The process ended while it was read
    }
    return {user: user_name_of(uid), command};
}

function user_name_of(uid)
{
    try {
        const line = fs.readFileSync('/etc/passwd', 'utf8').split('\n').find(v => v.split(':')[2] === String(uid));
        return (line === undefined) ? String(uid) : line.split(':')[0];
    }
    catch {
        return String(uid);
    }
}

function link_read(file)
{
    try {
        return fs.readlinkSync(file);
    }
    catch {
        return null;
    }
}

module.exports = {
    exists,
    file_remove,
    file_stat,
    folder_listable,
    folder_make,
    folder_names,
    folder_remove,
    folder_rename,
    free_of,
    image_grow,
    image_make,
    meta_names,
    meta_read,
    meta_write,
    mounted,
    path_real,
    room_of,
    run,
    user_of,
    mount_propagated,
    users_of,
};
