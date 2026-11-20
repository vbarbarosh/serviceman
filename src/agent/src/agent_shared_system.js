const agent_path_real = require('./agent_path_real');
const agent_volume_system = require('./agent_volume_system');
const child_process = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const mounts_read = require('./mounts_read');
const net = require('net');
const os = require('os');
const path = require('path');
const timers = require('timers/promises');

const RUN_TIMEOUT_MS = 900000;
// How long a mounted folder is given to answer a stat, and how its look says it is dead
const ALIVE_MS = 5000;
const ALIVE_DEAD = 3;
const ALIVE_SCRIPT = `try { require('fs').statSync(process.argv[1]); } catch (error) { process.exit((error.code === 'ENOTCONN') ? ${ALIVE_DEAD} : 0); }`;

// The looks at a folder still waiting, by the folder: one that never ends is a stuck mount
const looks = new Map();
const DOWNLOAD_TIMEOUT_MS = 300000;
const REDIRECTS_MOST = 5;
const RSA_BITS = 2048;

// What agent_shared asks of the machine, in one place, so its tests can give another. A
// command's secrets go in `env`, never in its argv: every user of the machine can read argv.
async function run(argv, options)
{
    const env = Object.assign({}, process.env, {LC_ALL: 'C'}, ((options === undefined) || (options.env === undefined)) ? {} : options.env);
    return await new Promise(function (resolve) {
        const child = child_process.spawn(argv[0], argv.slice(1), {env, timeout: RUN_TIMEOUT_MS});
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
        child.stdin.end();
    });
}

async function json_read(file)
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

// Whole or not at all, root's alone
async function file_write(file, text)
{
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
    const temp = `${file}.new`;
    fs.writeFileSync(temp, text, {mode: 0o600});
    fs.renameSync(temp, file);
}

async function file_remove(file)
{
    fs.rmSync(file, {force: true});
}

async function file_exists(file)
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

// Where a path leads, with no link followed below `base`: agent_path_real says it
async function path_real(given, base)
{
    return agent_path_real(given, base);
}

// The folder and the ones above it; a new one is root's, 0700 below the shared folder's own
async function folder_make(dir, mode)
{
    fs.mkdirSync(dir, {recursive: true, mode: (mode === undefined) ? 0o755 : mode});
}

// A folder handed to the person the root half serves, so their programs may write in it: the
// folder itself, opened with no link followed under its name, since whoever writes in the
// volume may put one there
async function folder_give(dir, uid, gid)
{
    const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
        fs.fchownSync(fd, uid, gid);
        fs.fchmodSync(fd, 0o775);
    }
    finally {
        fs.closeSync(fd);
    }
}

async function mounts()
{
    return mounts_read('/proc/self/mountinfo');
}

// Whether a mounted folder answers: a FUSE mount whose program died says ENOTCONN to everything,
// and one whose program stalls (an sshfs whose connection went quiet) says nothing at all, a
// stat of it waiting in the kernel beyond any signal. So it is looked at from a child process
// given ALIVE_MS: this half has one thread, every machine's jobs on it, and a stat of its own
// would stop them all. A look still waiting from before is the answer itself: no second child
// is sent after it.
async function folder_alive(dir)
{
    if (looks.has(dir)) {
        return false;
    }
    const look = new Promise(function (resolve) {
        const child = child_process.spawn(process.execPath, ['-e', ALIVE_SCRIPT, dir], {stdio: 'ignore'});
        const timer = setTimeout(function () {
            child.kill('SIGKILL');
            resolve(false);
        }, ALIVE_MS);
        child.on('error', function () {
            clearTimeout(timer);
            looks.delete(dir);
            resolve(true);
        });
        child.on('exit', function (code) {
            clearTimeout(timer);
            looks.delete(dir);
            resolve(code !== ALIVE_DEAD);
        });
    });
    looks.set(dir, look);
    return await look;
}

// A FUSE mount that does not answer, cut off: every request waiting on it ends with ENOTCONN,
// the processes stuck in them go on, and its program finds its device closed and ends — what a
// kill -9 of the stalled sshfs does by hand. The kernel's own switch for it is the mount's file
// under /sys/fs/fuse/connections, named by its device; the program itself is killed as well,
// for a machine that has no fusectl mounted. Whether anything was cut.
async function fuse_abort(point)
{
    const found = mounts_read('/proc/self/mountinfo').find(v => v.point === point);
    if (found === undefined) {
        return false;
    }
    let cut = false;
    const [major, minor] = found.dev.split(':');
    if (major === '0') {
        try {
            fs.writeFileSync(`/sys/fs/fuse/connections/${minor}/abort`, '1');
            cut = true;
        }
        catch {
            // No fusectl, or the connection is gone already
        }
    }
    for (const pid of fuse_programs(point)) {
        try {
            process.kill(pid, 'SIGKILL');
            cut = true;
        }
        catch {
            // It ended on its own
        }
    }
    return cut;
}

// The programs serving a mount: those whose arguments name its point, sshfs or juicefs
function fuse_programs(point)
{
    const out = [];
    for (const name of fs.readdirSync('/proc')) {
        if (/^\d+$/.test(name) === false) {
            continue;
        }
        let argv = [];
        try {
            argv = fs.readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0');
        }
        catch {
            continue;
        }
        if (['sshfs', 'juicefs'].includes(path.basename(argv[0])) && argv.includes(point)) {
            out.push(Number(name));
        }
    }
    return out;
}

async function users_of(target, source)
{
    return await agent_volume_system.users_of(target, source);
}

// The space the folder's file system has: used and free
async function room_of(dir)
{
    const stat = fs.statfsSync(dir);
    return {used: (stat.blocks - stat.bfree)*stat.bsize, free: stat.bavail*stat.bsize};
}

// The machine's architecture as release archives name it
async function arch()
{
    return os.arch();
}

// A file from https, redirects followed, written whole or not at all
async function download(url, file)
{
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
    const temp = `${file}.part`;
    try {
        await download_to(url, temp, REDIRECTS_MOST);
        fs.renameSync(temp, file);
    }
    finally {
        fs.rmSync(temp, {force: true});
    }
}

async function sha256_of(file)
{
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Whether something answers on the port: a connection taken, then closed at once
async function port_open(host, port, timeout_ms)
{
    return await new Promise(function (resolve) {
        const socket = net.connect({host, port});
        const timer = setTimeout(function () {
            socket.destroy();
            resolve(false);
        }, timeout_ms);
        socket.on('connect', function () {
            clearTimeout(timer);
            socket.destroy();
            resolve(true);
        });
        socket.on('error', function () {
            clearTimeout(timer);
            resolve(false);
        });
    });
}

// An RSA private key, PKCS#1 under AES-256 with the passphrase: the form juicefs writes itself
// and reads back with that passphrase
async function key_make(passphrase)
{
    const pair = crypto.generateKeyPairSync('rsa', {
        modulusLength: RSA_BITS,
        publicKeyEncoding: {type: 'pkcs1', format: 'pem'},
        privateKeyEncoding: {type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase},
    });
    return pair.privateKey;
}

// A user of this machine: {name, uid, gid}, or null
async function user_of(name)
{
    const answer = await run(['getent', 'passwd', name]);
    const fields = answer.stdout.trim().split(':');
    if ((answer.code !== 0) || (fields.length < 7)) {
        return null;
    }
    return {name, uid: parseInt(fields[2], 10), gid: parseInt(fields[3], 10)};
}

async function sleep(ms)
{
    await timers.setTimeout(ms);
}

function download_to(url, file, redirects_left)
{
    return new Promise(function (resolve, reject) {
        const request = https.get(url, {timeout: DOWNLOAD_TIMEOUT_MS}, function (res) {
            if ((res.statusCode >= 300) && (res.statusCode < 400) && (res.headers.location !== undefined)) {
                res.resume();
                if (redirects_left === 0) {
                    reject(new Error(`${url}: too many redirects`));
                    return;
                }
                download_to(new URL(res.headers.location, url).toString(), file, redirects_left - 1).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`${url}: ${res.statusCode}`));
                return;
            }
            const written = fs.createWriteStream(file, {mode: 0o600});
            res.pipe(written);
            written.on('finish', resolve);
            written.on('error', reject);
            res.on('error', reject);
        });
        request.on('timeout', function () {
            request.destroy(new Error(`${url}: no answer in ${DOWNLOAD_TIMEOUT_MS/1000} s`));
        });
        request.on('error', reject);
    });
}

module.exports = {
    arch,
    download,
    file_exists,
    file_remove,
    file_write,
    folder_alive,
    fuse_abort,
    folder_give,
    folder_make,
    folder_names,
    json_read,
    key_make,
    mounts,
    path_real,
    port_open,
    room_of,
    run,
    sha256_of,
    sleep,
    user_of,
    users_of,
};
