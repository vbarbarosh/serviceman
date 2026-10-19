const crypto = require('crypto');
const path = require('path');

// A part of a copy between two disks. The link to a disk has no body limit, so a part is only
// how much a dropped connection costs.
const PART_BYTES = 32*1024*1024;

// The longest pause between two tries, in seconds; the first is one, then two, four…
const RETRY_MAX_S = 30;

// Errors that trying again will not change: a file that is not there, or may not be read
const RE_LASTING = /ENOENT|EACCES|EPERM|EISDIR|ENOTDIR|ENOSPC|a name of its own|not copied yet|into itself|cannot list a whole tree|is there already/;

// A file of a folder up to this size goes with others in one tar; a bigger one goes alone, in
// parts, so a link that drops costs a part of it and not the whole
const SMALL_FILE_BYTES = 8*1024*1024;
// How much one tar of small files carries at most, in bytes and in names
const BATCH_BYTES = 64*1024*1024;
const BATCH_NAMES = 1000;
// The names left out of a folder's copy that are kept by name; past these, only counted
const LEFT_KEPT = 20;

// How much older than its finish a file may look and still be the one that finish made
const FINISH_SLACK_MS = 10*60*1000;

// Copies of files and folders from one disk to another, run by the server and not by a page:
// a page may close, the copy goes on. One copy at a time, in the order they were asked for. A
// file goes in parts, and a disk that drops is waited for and asked where the file stands, so
// the copy carries on from there. A folder is walked on the disk it comes from first; then its
// small files go in tars of many, its big ones in parts, its links last, and a drop carries on
// from the step it reached.
//
//     options = {disk_of, log, part_bytes}
//     disk_of(name)        the disk of that name, or null while it cannot be reached
//     log(event, fields)   what was done, for the host's own log
//     part_bytes           how big a part is; 32 MB by default
//     small_bytes          how big a file of a folder may be and still go in a tar; 8 MB
//
// A disk may say what its agent does already, can(feature): a disk without can, or one that
// cannot do folder_copy, gets a folder file by file, without its links.
//
// The queue is {items, add(from, to), cancel(id), clear()}, where from is {disk, path} and to
// is {disk, dir}.
function transfer_queue(options)
{
    const log = (options.log === undefined) ? function () {} : options.log;
    const ctx = {disk_of: options.disk_of, log, part_bytes: (options.part_bytes === undefined) ? PART_BYTES : options.part_bytes, small_bytes: (options.small_bytes === undefined) ? SMALL_FILE_BYTES : options.small_bytes};
    const out = {items: [], running: false};
    out.add = function (from, to) {
        const item = item_make(from, to);
        out.items.push(item);
        queue_run(out, ctx);
        return item;
    };
    out.cancel = function (id) {
        const item = out.items.find(v => v.id === id);
        if (item === undefined) {
            return false;
        }
        item.cancelled = true;
        if (item.phase === 'waiting') {
            item.phase = 'cancelled';
        }
        if (item.wake !== undefined) {
            item.wake();
        }
        if (item.abort !== undefined) {
            item.abort();
        }
        return true;
    };
    // What is over is taken off the list; what is still on its way stays
    out.clear = function () {
        out.items = out.items.filter(v => (v.phase === 'waiting') || (v.phase === 'copying') || (v.phase === 'retrying'));
    };
    return out;
}

// One copy as the queue keeps it, before it starts. For a folder, size and received count the
// bytes of all its files, files and files_done its files, and left what was not copied.
function item_make(from, to)
{
    const from_path = path.posix.normalize(String(from.path)).replace(/(.)\/+$/, '$1');
    const id = crypto.randomBytes(8).toString('hex');
    return {
        id,
        from: {disk: String(from.disk), path: from_path},
        to: {disk: String(to.disk), dir: String(to.dir)},
        name: path.posix.basename(from_path),
        kind: null,
        size: null,
        received: 0,
        files: null,
        files_done: 0,
        left: {links: 0, others: 0, unread: 0, names: []},
        began_at: null,
        began_ms: null,
        phase: 'waiting',
        said: '',
        wait_s: 0,
        path: null,
        cancelled: false,
        // The file on its way: {from_path, dir, name, id, size, mode, received, finish_sent_at}
        piece: null,
        // A folder's walk, and the step it has reached: {steps, at, bytes_done}
        walk: null,
    };
}

async function queue_run(queue, ctx)
{
    if (queue.running) {
        return;
    }
    queue.running = true;
    try {
        for (;;) {
            const item = queue.items.find(v => v.phase === 'waiting');
            if (item === undefined) {
                break;
            }
            await transfer_run(item, ctx);
            // A folder's walk is many names, and nobody asks for them once it is over
            item.walk = null;
        }
    }
    finally {
        queue.running = false;
    }
}

// One file or one folder, from where it stood: a try that fails waits and goes on from there
async function transfer_run(item, ctx)
{
    const disk_of = ctx.disk_of;
    const log = ctx.log;
    item.phase = 'copying';
    item.began_ms = Date.now();
    log('transfer_begin', {id: item.id, from: item.from.disk, path: item.from.path, to: item.to.disk, dir: item.to.dir});
    let failures = 0;
    // A step that went somewhere: the next failure waits a second again
    function progressed() {
        failures = 0;
    }
    while (item.cancelled === false) {
        try {
            const from = disk_or_throw(disk_of, item.from.disk);
            const to = disk_or_throw(disk_of, item.to.disk);
            if (item.kind === null) {
                const stat = await from.stat(item.from.path);
                if (stat.kind === 'dir') {
                    folder_check(item);
                }
                else {
                    item.size = stat.size;
                    item.piece = {from_path: item.from.path, dir: item.to.dir, name: item.name, id: item.id, size: stat.size, mode: stat.mode, received: 0, finish_sent_at: null};
                }
                item.kind = stat.kind;
            }
            if (item.kind === 'dir') {
                await folder_copy(item, from, to, ctx, progressed);
            }
            else {
                const landed = await piece_copy(item, item.piece, from, to, ctx, function () {
                    item.received = item.piece.received;
                    if (item.began_at === null) {
                        item.began_at = item.received;
                    }
                    progressed();
                });
                item.path = (landed === null) ? null : landed.path;
            }
            if (item.cancelled) {
                break;
            }
            item.phase = 'ok';
            item.said = left_said(item);
            log('transfer_end_ok', (item.kind === 'dir') ? {id: item.id, path: item.path, files: item.files_done, bytes: item.received, left: left_count(item)} : {id: item.id, path: item.path, bytes: item.size});
            return;
        }
        catch (error) {
            if (item.cancelled) {
                break;
            }
            if (RE_LASTING.test(error.message)) {
                item.phase = 'error';
                item.said = error.message;
                log('transfer_end_error', {id: item.id, reason: error.message});
                return;
            }
            failures++;
            item.phase = 'retrying';
            item.said = error.message;
            await wait_out(item, Math.min(RETRY_MAX_S, 2**(failures - 1)));
            if (item.cancelled === false) {
                item.phase = 'copying';
            }
        }
    }
    if (item.phase === 'ok') {
        return;
    }
    item.phase = 'cancelled';
    if (item.kind === 'dir') {
        item.said = `${item.files_done} of ${item.files} ${plural(item.files, 'file', 'files')} landed`;
    }
    log('transfer_cancelled', {id: item.id});
    // What came of the file on its way goes: a part of a file is nobody's file
    const to = disk_of(item.to.disk);
    if ((to !== null) && (item.piece !== null)) {
        to.part_remove(item.piece.dir, item.piece.name, item.piece.id).catch(function () {});
    }
}

// A folder copied into itself would never end, and / has no name to land under
function folder_check(item)
{
    if (item.name === '/') {
        throw new Error('a whole disk is not copied into itself');
    }
    const dir = path.posix.normalize(item.to.dir);
    if ((item.from.disk === item.to.disk) && ((dir === item.from.path) || dir.startsWith(`${item.from.path}/`))) {
        throw new Error('a folder is not copied into itself');
    }
}

// One file, part after part, from where the disk it goes to says it stands; null when the
// copy was given up on the way
async function piece_copy(item, piece, from, to, ctx, moved)
{
    piece.received = (await to.part_stat(piece.dir, piece.name, piece.id)).received;
    moved();
    if (await finished_already(piece, to)) {
        moved();
        return {path: path.posix.join(piece.dir, piece.name)};
    }
    while ((piece.received < piece.size) && (item.cancelled === false)) {
        const end = Math.min(piece.size, piece.received + ctx.part_bytes) - 1;
        const source = from.read(piece.from_path, {start: piece.received, end});
        // Cancel ends the part on its way at once, rather than when its link gives up
        item.abort = function () {
            source.destroy(new Error('the copy was given up'));
        };
        try {
            piece.received = (await to.part_write(piece.dir, piece.name, piece.id, piece.received, source)).received;
        }
        finally {
            delete item.abort;
        }
        moved();
    }
    if (item.cancelled) {
        return null;
    }
    piece.finish_sent_at = Date.now();
    return await to.part_finish(piece.dir, piece.name, piece.id, piece.size, piece.mode);
}

// A folder, step after step: the walk the first time, then the folder itself, the tars of
// small files, the big files one by one, and the links
async function folder_copy(item, from, to, ctx, progressed)
{
    const root = path.posix.join(item.to.dir, item.name);
    if (item.walk === null) {
        const walk = await walk_read(from, item.from.path);
        item.walk = {steps: steps_of(item, walk, from, to, ctx), at: 0, bytes_done: 0};
        item.files = walk.files.length;
        item.size = walk.files.reduce((sum, v) => sum + v.size, 0);
        item.left.others = walk.others.length;
        for (const unread of walk.unread) {
            left_add(item, unread.path, unread.error);
        }
        if (item.walk.steps.some(v => v.kind === 'links') === false) {
            item.left.links = walk.links.length;
        }
        progressed();
    }
    const walk = item.walk;
    while ((walk.at < walk.steps.length) && (item.cancelled === false)) {
        const step = walk.steps[walk.at];
        if (step.kind === 'root') {
            await to.mkdir(root);
        }
        else if (step.kind === 'dirs') {
            for (; step.done < step.names.length; step.done++) {
                await to.mkdir(path.posix.join(root, step.names[step.done]));
            }
        }
        else if (step.kind === 'tar') {
            try {
                await tar_copy(item, step, from, to, progressed);
            }
            catch (error) {
                // A tar that failed goes file by file the next time: a file that cannot be
                // read is then left out alone, and the others still land
                const alone = step.files.map(v => ({kind: 'file', file: v}));
                if (step.dirs.length > 0) {
                    alone.push({kind: 'dirs', names: step.dirs, done: 0});
                }
                walk.steps.splice(walk.at, 1, ...alone);
                item.received = walk.bytes_done;
                throw error;
            }
        }
        else if (step.kind === 'file') {
            if (await file_step(item, step, from, to, ctx, progressed) === false) {
                break;
            }
        }
        else if (step.kind === 'links') {
            for (; step.done < step.links.length; step.done++) {
                const link = step.links[step.done];
                try {
                    await to.link_create(path.posix.join(root, link.path), link.target);
                }
                catch (error) {
                    if (RE_LASTING.test(error.message) === false) {
                        throw error;
                    }
                    left_add(item, link.path, error.message);
                }
            }
        }
        walk.at++;
        walk.bytes_done += step_bytes(step);
        item.files_done += step_files(step);
        item.received = walk.bytes_done;
        progressed();
    }
    item.path = root;
}

// One big file of a folder, in parts. One that cannot be read is left out, and the folder
// goes on; false when the copy was given up on the way.
async function file_step(item, step, from, to, ctx, progressed)
{
    const walk = item.walk;
    const file = step.file;
    const rel_dir = path.posix.dirname(file.path);
    if ((item.piece === null) || (item.piece.from_path !== path.posix.join(item.from.path, file.path))) {
        item.piece = {
            from_path: path.posix.join(item.from.path, file.path),
            dir: path.posix.join(item.to.dir, item.name, (rel_dir === '.') ? '' : rel_dir),
            name: path.posix.basename(file.path),
            id: `${item.id}f${walk.at}`,
            size: file.size,
            mode: file.mode,
            received: 0,
            finish_sent_at: null,
        };
    }
    try {
        const landed = await piece_copy(item, item.piece, from, to, ctx, function () {
            item.received = walk.bytes_done + item.piece.received;
            progressed();
        });
        if (landed === null) {
            return false;
        }
    }
    catch (error) {
        if (RE_LASTING.test(error.message) === false) {
            throw error;
        }
        left_add(item, file.path, error.message);
        step.left = true;
    }
    item.piece = null;
    return true;
}

// Small files of a folder as one tar, read on one disk and written on the other as it comes;
// what it has carried so far counts toward the copy, its headers aside
async function tar_copy(item, step, from, to, progressed)
{
    const walk = item.walk;
    const parent = path.posix.dirname(item.from.path);
    const names = step.files.map(v => `${item.name}/${v.path}`).concat(step.dirs.map(v => `${item.name}/${v}`));
    const source = from.tar(parent, names, {paths: true});
    let carried = 0;
    source.on('data', function (chunk) {
        carried += chunk.length;
        item.received = walk.bytes_done + Math.min(step.bytes, carried);
    });
    // Cancel ends the tar at once: the files that were whole stay, the one on its way goes
    item.abort = function () {
        source.destroy(new Error('the copy was given up'));
    };
    try {
        await to.write_tar(item.to.dir, source);
    }
    finally {
        delete item.abort;
    }
    progressed();
}

// Every name under a folder, as the disk it is on walks it: {files, dirs, links, others,
// unread}, each path relative to the folder
function walk_read(disk, dir)
{
    if (disk.tree === undefined) {
        return Promise.reject(new Error('this disk cannot list a whole tree'));
    }
    return new Promise(function (resolve, reject) {
        const walk = {files: [], dirs: [], links: [], others: [], unread: []};
        const stream = disk.tree(dir, {hash: false, skip: []});
        let rest = '';
        let ended = false;
        stream.on('data', function (chunk) {
            const lines = (rest + chunk.toString('utf8')).split('\n');
            rest = lines.pop();
            for (const text of lines) {
                if (text.trim() === '') {
                    continue;
                }
                const line = JSON.parse(text);
                if (line.type === 'file') {
                    walk.files.push({path: line.path, size: line.size, mode: line.mode});
                }
                else if (line.type === 'dir') {
                    walk.dirs.push(line.path);
                }
                else if (line.type === 'link') {
                    walk.links.push({path: line.path, target: line.target});
                }
                else if (line.type === 'other') {
                    walk.others.push(line.path);
                }
                else if (line.type === 'error') {
                    walk.unread.push({path: line.path, error: line.error});
                }
                else if (line.type === 'end') {
                    ended = true;
                }
            }
        });
        stream.on('error', reject);
        stream.on('end', function () {
            if (ended === false) {
                reject(new Error('the walk of the folder stopped short'));
                return;
            }
            resolve(walk);
        });
    });
}

// What a folder's copy does, in order. Small files go in tars when both agents can, with the
// folders that are empty; otherwise every file goes alone and the empty folders are made one
// by one. Links come last, so no file of this copy is written through one of them.
function steps_of(item, walk, from, to, ctx)
{
    const tars = can(from, 'folder_copy') && can(to, 'tar_put');
    const full = new Set();
    for (const name of [].concat(walk.files.map(v => v.path), walk.dirs, walk.links.map(v => v.path), walk.others, walk.unread.map(v => v.path))) {
        const parts = name.split('/');
        for (let i = 1; i < parts.length; i++) {
            full.add(parts.slice(0, i).join('/'));
        }
    }
    const empty = walk.dirs.filter(v => (full.has(v) === false));
    const out = [{kind: 'root'}];
    let batch = null;
    for (const file of walk.files) {
        if ((tars === false) || (file.size > ctx.small_bytes)) {
            out.push({kind: 'file', file});
            continue;
        }
        if ((batch === null) || (batch.bytes + file.size > BATCH_BYTES) || (batch.files.length >= BATCH_NAMES)) {
            batch = {kind: 'tar', files: [], dirs: [], bytes: 0};
            out.push(batch);
        }
        batch.files.push(file);
        batch.bytes += file.size;
    }
    if (tars) {
        for (let i = 0; i < empty.length; i += BATCH_NAMES) {
            out.push({kind: 'tar', files: [], dirs: empty.slice(i, i + BATCH_NAMES), bytes: 0});
        }
    }
    else if (empty.length > 0) {
        out.push({kind: 'dirs', names: empty, done: 0});
    }
    if ((walk.links.length > 0) && can(to, 'folder_copy')) {
        out.push({kind: 'links', links: walk.links, done: 0});
    }
    return out;
}

function can(disk, feature)
{
    return (disk.can === undefined) ? false : disk.can(feature);
}

function step_bytes(step)
{
    if (step.kind === 'tar') {
        return step.bytes;
    }
    if (step.kind === 'file') {
        return step.file.size;
    }
    return 0;
}

function step_files(step)
{
    if (step.kind === 'tar') {
        return step.files.length;
    }
    if ((step.kind === 'file') && (step.left !== true)) {
        return 1;
    }
    return 0;
}

// A name that was not copied: counted, and kept by name while there are few
function left_add(item, name, error)
{
    item.left.unread++;
    if (item.left.names.length < LEFT_KEPT) {
        item.left.names.push({path: name, said: error});
    }
}

function left_count(item)
{
    return item.left.links + item.left.others + item.left.unread;
}

// What a folder's copy left out, in a few words; nothing when it left nothing
function left_said(item)
{
    if (item.kind !== 'dir') {
        return '';
    }
    const said = [];
    if (item.left.unread > 0) {
        said.push(`${item.left.unread} ${plural(item.left.unread, 'name', 'names')} could not be copied`);
    }
    if (item.left.links > 0) {
        said.push(`${item.left.links} ${plural(item.left.links, 'link', 'links')} left out: ${item.to.disk}'s agent makes no links yet`);
    }
    if (item.left.others > 0) {
        said.push(`${item.left.others} ${plural(item.left.others, 'socket or device', 'sockets or devices')} left out`);
    }
    return said.join(' · ');
}

function plural(n, one, many)
{
    return (n === 1) ? one : many;
}

function disk_or_throw(disk_of, name)
{
    const out = disk_of(name);
    if (out === null) {
        throw new Error(`${name} cannot be reached`);
    }
    return out;
}

// A finish whose answer was lost leaves no part behind and the file in place: nothing is in,
// yet the file is there, as big as it should be, and no older than the finish
async function finished_already(piece, to)
{
    if ((piece.received !== 0) || (piece.finish_sent_at === null)) {
        return false;
    }
    let stat;
    try {
        stat = await to.stat(path.posix.join(piece.dir, piece.name));
    }
    catch {
        return false;
    }
    if ((stat.size !== piece.size) || (stat.mtime_ms < piece.finish_sent_at - FINISH_SLACK_MS)) {
        return false;
    }
    piece.received = piece.size;
    return true;
}

// A pause before trying again, counted down for whoever is watching; Cancel ends it at once
function wait_out(item, seconds)
{
    item.wait_s = seconds;
    return new Promise(function (resolve) {
        const timer = setInterval(function () {
            item.wait_s--;
            if (item.wait_s <= 0) {
                item.wake();
            }
        }, 1000);
        // A copy waiting for a machine does not keep the process alive
        timer.unref();
        item.wake = function () {
            clearInterval(timer);
            delete item.wake;
            resolve();
        };
    });
}

module.exports = transfer_queue;
