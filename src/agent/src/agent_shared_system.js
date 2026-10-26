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

// The folder and the ones above it; a new one is root's, 0700 below the shared folder's own
async function folder_make(dir, mode)
{
    fs.mkdirSync(dir, {recursive: true, mode: (mode === undefined) ? 0o755 : mode});
}

// A folder handed to the person the root half serves, so their programs may write in it
async function folder_give(dir, uid, gid)
{
    fs.chownSync(dir, uid, gid);
    fs.chmodSync(dir, 0o775);
}

async function mounts()
{
    return mounts_read('/proc/self/mountinfo');
}

// Whether a mounted folder answers: a FUSE mount whose program died says ENOTCONN to everything
async function folder_alive(dir)
{
    try {
        fs.statSync(dir);
        return true;
    }
    catch (error) {
        return error.code !== 'ENOTCONN';
    }
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
    folder_give,
    folder_make,
    folder_names,
    json_read,
    key_make,
    mounts,
    port_open,
    room_of,
    run,
    sha256_of,
    sleep,
    user_of,
    users_of,
};
