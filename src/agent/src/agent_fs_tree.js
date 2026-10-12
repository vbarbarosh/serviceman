const agent_fs_path = require('./agent_fs_path');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const stream = require('stream');

// A tree this big is not one answer: a home folder asked by mistake, not a project
const TREE_MAX_FILES = 200000;
// Names read before the walk lets the agent's other work in: each is a stat that does not wait
// on the thread pool, which on a busy machine is what makes a walk slow
const NAMES_AT_ONCE = 512;
// Files read for their hash at once, across folders; and how many of them make one line batch.
// A file up to the small size is read whole in one call, so a slice holds the agent's other
// work back for a few milliseconds at most.
const HASH_AT_ONCE = 8;
const HASH_SLICE = 256;
const SMALL_FILE_BYTES = 64*1024;
// The hashes kept between calls, the oldest dropped first
const HASHES_KEPT = 200000;

// Every file's hash read so far, by its full path: {size, mtime_ms, ino, sha256}
const hashes = new Map();

// Every file under a folder of this machine, at any depth, read as the agent's own user. It
// answers the way a socket does, in lines of JSON, so the tunnel carries a tree of any size,
// held back by the link's own credit. Folders are not said, only what is in them; a link is
// said as a link and never followed; the names in `skip` are left out, wherever they are; a
// socket, a pipe or a device is no file to copy and is left out too.
//
//     target = {path, hash, skip}
//     {"type": "start", "path"}                                       the folder, in full
//     {"type": "file", "path", "size", "mtime_ms", "sha256"?}         sha256 with hash: true
//     {"type": "link", "path", "target", "mtime_ms"}
//     {"type": "unread", "path", "error"}                             a folder or a name it could not read
//     {"type": "end", "files", "links", "bytes", "hashed", "ms"}      hashed: files read for their hash
//
// `path` of a name is relative to the folder asked, with / between its parts. A file it could
// not read for its hash has sha256 null and an error.
function agent_fs_tree(target)
{
    const out = stream.Readable.from(lines(target), {objectMode: false});
    out.setNoDelay = function () {};
    out.write = function () {};
    out.end = function () {};
    return out;
}

// The number of files read for their hash since the agent started, for the tests
agent_fs_tree.reads = 0;

// Without hashes each folder goes out as it is read; with them the files wait for the walk,
// then go out a slice at a time as their hashes are ready
async function* lines(target)
{
    const time0 = Date.now();
    const root = agent_fs_path(target.path);
    const hash = (target.hash === true);
    const skip = new Set(Array.isArray(target.skip) ? target.skip.map(String) : []);
    const stat = await fs.promises.stat(root);
    if (stat.isDirectory() === false) {
        throw new Error(`${root} is not a folder`);
    }
    yield lines_of([{type: 'start', path: root}]);
    const end = {type: 'end', files: 0, links: 0, bytes: 0, hashed: 0, ms: 0};
    const files = [];
    const dirs = [''];
    let names = 0;
    while (dirs.length > 0) {
        const rel = dirs.pop();
        const found = folder_read(root, rel, skip);
        const said = [];
        // Folder by folder, depth first, each one's names in order
        const deeper = [];
        for (const item of found) {
            if (item.type === 'dir') {
                deeper.push(item.path);
                continue;
            }
            if (item.type === 'file') {
                end.files++;
                end.bytes += item.size;
                if (end.files > TREE_MAX_FILES) {
                    throw new Error(`more than ${TREE_MAX_FILES} files under ${root}; skip some of them`);
                }
                if (hash) {
                    files.push(item);
                    continue;
                }
            }
            else if (item.type === 'link') {
                end.links++;
            }
            said.push(item);
        }
        dirs.push(...deeper.reverse());
        if (said.length > 0) {
            yield lines_of(said);
        }
        names += found.length + 1;
        if (names >= NAMES_AT_ONCE) {
            names = 0;
            await new Promise(v => setImmediate(v));
        }
    }
    for (let i = 0; i < files.length; i += HASH_SLICE) {
        const slice = files.slice(i, i + HASH_SLICE);
        await pool(slice, HASH_AT_ONCE, async function (item) {
            if (await hash_fill(item)) {
                end.hashed++;
            }
        });
        yield lines_of(slice);
        await new Promise(v => setImmediate(v));
    }
    end.ms = Date.now() - time0;
    yield lines_of([end]);
}

// One folder's names, each by what lstat says of it, in the order of names. A folder that
// cannot be read is one unread line; a name gone between the folder read and its stat is no
// longer there to list.
function folder_read(root, rel, skip)
{
    let entries;
    try {
        entries = fs.readdirSync(path.join(root, rel), {withFileTypes: true});
    }
    catch (error) {
        return [{type: 'unread', path: rel, error: error.message}];
    }
    const names = entries.map(v => v.name).filter(v => (skip.has(v) === false));
    names.sort((a, b) => ((a < b) ? -1 : ((a > b) ? 1 : 0)));
    const out = [];
    for (const name of names) {
        const item_path = ((rel === '') ? name : `${rel}/${name}`);
        const full = path.join(root, item_path);
        let stat;
        try {
            stat = fs.lstatSync(full, {throwIfNoEntry: false});
        }
        catch (error) {
            out.push({type: 'unread', path: item_path, error: error.message});
            continue;
        }
        if (stat === undefined) {
            continue;
        }
        if (stat.isDirectory()) {
            out.push({type: 'dir', path: item_path});
        }
        else if (stat.isFile()) {
            out.push({type: 'file', path: item_path, size: stat.size, mtime_ms: Math.round(stat.mtimeMs), full, stat});
        }
        else if (stat.isSymbolicLink()) {
            try {
                out.push({type: 'link', path: item_path, target: fs.readlinkSync(full), mtime_ms: Math.round(stat.mtimeMs)});
            }
            catch (error) {
                out.push({type: 'unread', path: item_path, error: error.message});
            }
        }
    }
    return out;
}

// Each item through fn, `width` of them at a time
async function pool(items, width, fn)
{
    let next = 0;
    async function lane() {
        while (next < items.length) {
            await fn(items[next++]);
        }
    }
    const lanes = [];
    for (let i = 0; i < width; i++) {
        lanes.push(lane());
    }
    await Promise.all(lanes);
}

// The file's sha256, from what was kept while its size, time and inode are the same; read
// again when any of them changed; true when the file was read. A file it cannot read stays in
// the list with sha256 null.
async function hash_fill(item)
{
    const full = item.full;
    const stat = item.stat;
    const kept = hashes.get(full);
    if ((kept !== undefined) && (kept.size === stat.size) && (kept.mtime_ms === stat.mtimeMs) && (kept.ino === stat.ino)) {
        hashes.delete(full);
        hashes.set(full, kept);
        item.sha256 = kept.sha256;
        return false;
    }
    let after;
    try {
        agent_fs_tree.reads++;
        // A small file in one read: a stream costs more than the file
        if (stat.size <= SMALL_FILE_BYTES) {
            item.sha256 = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
            after = fs.lstatSync(full);
        }
        else {
            item.sha256 = await file_sha256(full);
            after = await fs.promises.lstat(full);
        }
    }
    catch (error) {
        item.sha256 = null;
        item.error = error.message;
        return true;
    }
    // A file written while it was read has a hash of neither version: it is said, and not kept
    hashes.delete(full);
    if ((after.size !== stat.size) || (after.mtimeMs !== stat.mtimeMs) || (after.ino !== stat.ino)) {
        return true;
    }
    hashes.set(full, {size: stat.size, mtime_ms: stat.mtimeMs, ino: stat.ino, sha256: item.sha256});
    if (hashes.size > HASHES_KEPT) {
        hashes.delete(hashes.keys().next().value);
    }
    return true;
}

function file_sha256(full)
{
    return new Promise(function (resolve, reject) {
        const sha = crypto.createHash('sha256');
        const file = fs.createReadStream(full);
        file.on('error', reject);
        file.on('data', function (chunk) {
            sha.update(chunk);
        });
        file.on('end', function () {
            resolve(sha.digest('hex'));
        });
    });
}

function lines_of(items)
{
    let text = '';
    for (const item of items) {
        const said = Object.assign({}, item);
        delete said.stat;
        delete said.full;
        text += `${JSON.stringify(said)}\n`;
    }
    return Buffer.from(text);
}

module.exports = agent_fs_tree;
