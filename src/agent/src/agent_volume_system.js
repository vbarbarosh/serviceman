const child_process = require('child_process');
const fs = require('fs');
const path = require('path');

const RUN_TIMEOUT_MS = 600000;
const SECTOR_BYTES = 512;

// What agent_volume asks of the machine, in one place, so its tests can give another
async function run(argv, input)
{
    return await new Promise(function (resolve) {
        const child = child_process.spawn(argv[0], argv.slice(1), {env: Object.assign({}, process.env, {LC_ALL: 'C'}), timeout: RUN_TIMEOUT_MS});
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

// What a folder holds, or null when there is no such folder
async function folder_names(dir)
{
    try {
        return fs.readdirSync(dir);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

async function folder_make(dir, uid, gid)
{
    if (fs.existsSync(dir) === false) {
        fs.mkdirSync(dir, {mode: 0o700});
    }
    fs.chownSync(dir, uid, gid);
}

async function folder_rename(from, to)
{
    fs.renameSync(from, to);
}

async function folder_remove(dir)
{
    fs.rmdirSync(dir);
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

// /proc/<pid>/mountinfo: 36 35 98:0 /mnt1 /mnt2 rw,noatime master:1 - ext3 /dev/root rw
// peers are the optional fields between the options and the dash: shared:N, master:N
function mounts_read(file)
{
    let text = '';
    try {
        text = fs.readFileSync(file, 'utf8');
    }
    catch {
        return [];
    }
    const out = [];
    for (const line of text.split('\n')) {
        const halves = line.split(' - ');
        if (halves.length < 2) {
            continue;
        }
        const fields = halves[0].split(' ');
        out.push({point: octal_unescape(fields[4]), source: octal_unescape(halves[1].split(' ')[1]), peers: fields.slice(6)});
    }
    return out;
}

function octal_unescape(text)
{
    return String(text).replace(/\\([0-7]{3})/g, (match, code) => String.fromCharCode(parseInt(code, 8)));
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
    room_of,
    run,
    user_of,
    mount_propagated,
    users_of,
};
