const crypto = require('crypto');
const path = require('path');
const stream = require('stream');

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

// The speed across a copy, for its graph: sampled every second, as how fast the last three
// seconds went; past the most points kept, every other one goes
const SAMPLE_MS = 1000;
const SAMPLE_SPAN_MS = 3000;
const SAMPLES_MAX = 400;

// Copies of files and folders from one disk to another, run by the server and not by a page:
// a page may close, the copy goes on. One copy at a time, in the order they were asked for. A
// file goes in parts, and a disk that drops is waited for and asked where the file stands, so
// the copy carries on from there. A folder is walked on the disk it comes from first; then its
// small files go in tars of many, its big ones in parts, its links last, and a drop carries on
// from the step it reached. Each copy is weighed as soon as it is asked for, a folder walked,
// so a page counts every copy in line and not only the one under way.
//
// Pause stops the copy under way where it is, as a dropped link would, and starts no other;
// Resume carries it on from where the disk says it stands.
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
// The queue is {items, paused, add(from, to), cancel(id), clear(), pause(), resume()}, where
// from is {disk, path} and to is {disk, dir}.
function transfer_queue(options)
{
    const log = (options.log === undefined) ? function () {} : options.log;
    const out = {items: [], running: false, paused: false};
    const ctx = {disk_of: options.disk_of, log, part_bytes: (options.part_bytes === undefined) ? PART_BYTES : options.part_bytes, small_bytes: (options.small_bytes === undefined) ? SMALL_FILE_BYTES : options.small_bytes, queue: out, weighed: Promise.resolve()};
    out.add = function (from, to) {
        const item = item_make(from, to);
        out.items.push(item);
        // One copy weighed after the other, beside the one under way: a page counts it at once
        ctx.weighed = ctx.weighed.then(() => weigh(item, ctx)).catch(function () {});
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
        // Nothing left to carry on: the next copy asked for starts, rather than waiting paused
        if (out.items.some(v => (v.cancelled === false) && going(v)) === false) {
            out.paused = false;
        }
        return true;
    };
    // What is over is taken off the list; what is still on its way stays
    out.clear = function () {
        out.items = out.items.filter(going);
    };
    // Nothing to stop is nothing to pause
    out.pause = function () {
        if (out.paused || (out.items.some(going) === false)) {
            return;
        }
        out.paused = true;
        const item = out.items.find(v => (v.phase === 'copying') || (v.phase === 'retrying'));
        if (item === undefined) {
            return;
        }
        if (item.wake !== undefined) {
            item.wake();
        }
        if (item.abort !== undefined) {
            item.abort();
        }
    };
    out.resume = function () {
        if (out.paused === false) {
            return;
        }
        out.paused = false;
        const item = out.items.find(v => v.phase === 'paused');
        if ((item !== undefined) && (item.wake !== undefined)) {
            item.wake();
        }
        queue_run(out, ctx);
    };
    return out;
}

// Still to come: waiting its turn, under way, or paused halfway
function going(item)
{
    return ['waiting', 'copying', 'retrying', 'paused'].includes(item.phase);
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
        ended_ms: null,
        // How long it stood paused, so its rate counts the time it ran
        paused_ms: 0,
        paused_at: null,
        // The speed at each point of the way, for the page's graph: [{x, y}], x 0 to 1, y bytes a second
        samples: [],
        // What is on its way now: {label, size, done}, a file of a folder or a tar of its small ones
        now: null,
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
            // Paused, no other copy starts; Resume runs the queue again
            const item = queue.paused ? undefined : queue.items.find(v => v.phase === 'waiting');
            if (item === undefined) {
                break;
            }
            const sampler_stop = sampler_start(item);
            try {
                await transfer_run(item, ctx);
            }
            finally {
                sampler_stop();
                item.ended_ms = Date.now();
            }
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
            await pause_wait(item, ctx);
            if (item.cancelled) {
                break;
            }
            await weigh(item, ctx);
            const from = disk_or_throw(disk_of, item.from.disk);
            const to = disk_or_throw(disk_of, item.to.disk);
            if (item.kind === 'dir') {
                await folder_copy(item, from, to, ctx, progressed);
            }
            else {
                const landed = await piece_copy(item, item.piece, from, to, ctx, function () {
                    item.received = Math.min(item.piece.size, item.piece.received + piece_flowing(item.piece));
                    item.now = {label: item.name, size: item.piece.size, done: item.received};
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
            // Cut by Pause: it waits at the top, then goes on from where it stood
            if (ctx.queue.paused) {
                continue;
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
            // A pause that cut the wait short starts the next try from one second again
            if (ctx.queue.paused) {
                failures = 0;
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
        paused_throw(ctx.queue);
        const last = Math.min(piece.size, piece.received + ctx.part_bytes) - 1;
        const source = from.read(piece.from_path, {start: piece.received, end: last});
        // What the part has carried so far counts as it goes, so a big file's copy moves
        // smoothly and not a part at a time; a part that fails is read again from the disk's
        // word. Counted on the way through, never by listening: a listener would set the bytes
        // flowing before the disk is there to take them.
        piece.flowing = 0;
        const counted = new stream.Transform({
            transform: function (chunk, encoding, callback) {
                piece.flowing += chunk.length;
                moved();
                callback(null, chunk);
            },
        });
        source.on('error', e => counted.destroy(e));
        source.pipe(counted);
        // Cancel and Pause end the part on its way at once, rather than when its link gives
        // up: the stream the disk reads too, since the source may have handed it all its bytes
        // already
        item.abort = function () {
            source.destroy(new Error('the copy was stopped'));
            counted.destroy(new Error('the copy was stopped'));
        };
        try {
            piece.received = (await to.part_write(piece.dir, piece.name, piece.id, piece.received, counted)).received;
        }
        finally {
            piece.flowing = 0;
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

// What a copy carries, before it goes: a file's size, a folder's walk on the disk it comes
// from, and the steps that copy it. Once, however many ask: the copy's turn joins a weighing
// under way; one that failed is tried again on its turn, and fails the copy there.
function weigh(item, ctx)
{
    if (item.weighing === undefined) {
        item.weighing = weigh_run(item, ctx).finally(function () {
            delete item.weighing;
        });
    }
    return item.weighing;
}

async function weigh_run(item, ctx)
{
    if ((item.size !== null) || item.cancelled) {
        return;
    }
    const from = disk_or_throw(ctx.disk_of, item.from.disk);
    const to = disk_or_throw(ctx.disk_of, item.to.disk);
    const stat = await from.stat(item.from.path);
    if (stat.kind !== 'dir') {
        item.piece = {from_path: item.from.path, dir: item.to.dir, name: item.name, id: item.id, size: stat.size, mode: stat.mode, received: 0, finish_sent_at: null};
        item.kind = stat.kind;
        item.size = stat.size;
        return;
    }
    folder_check(item);
    item.kind = 'dir';
    const walk = await walk_read(from, item.from.path);
    item.walk = {steps: steps_of(item, walk, from, to, ctx), at: 0, bytes_done: 0};
    item.files = walk.files.length;
    item.left.others = walk.others.length;
    for (const unread of walk.unread) {
        left_add(item, unread.path, unread.error);
    }
    if (item.walk.steps.some(v => v.kind === 'links') === false) {
        item.left.links = walk.links.length;
    }
    item.size = walk.files.reduce((sum, v) => sum + v.size, 0);
}

// A folder, step after step, from the step it reached: the folder itself, the tars of small
// files, the big files one by one, and the links
async function folder_copy(item, from, to, ctx, progressed)
{
    const root = path.posix.join(item.to.dir, item.name);
    const walk = item.walk;
    while ((walk.at < walk.steps.length) && (item.cancelled === false)) {
        paused_throw(ctx.queue);
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
                // A tar cut by Pause goes again whole: the files it had landed are written over
                if (ctx.queue.paused) {
                    item.received = walk.bytes_done;
                    throw error;
                }
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
            const done = Math.min(item.piece.size, item.piece.received + piece_flowing(item.piece));
            item.received = walk.bytes_done + done;
            item.now = {label: `${item.name}/${file.path}`, size: item.piece.size, done};
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
    const label = `${item.name}: ${step.files.length} small ${(step.files.length === 1) ? 'file' : 'files'} in one go`;
    source.on('data', function (chunk) {
        carried += chunk.length;
        item.received = walk.bytes_done + Math.min(step.bytes, carried);
        item.now = {label, size: step.bytes, done: Math.min(step.bytes, carried)};
    });
    // Cancel and Pause end the tar at once: the files that were whole stay, the one on its
    // way goes
    item.abort = function () {
        source.destroy(new Error('the copy was stopped'));
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

// Paused, the copy stands where it stopped until Resume or Cancel; the time it stands is not
// counted as its own
async function pause_wait(item, ctx)
{
    if (ctx.queue.paused === false) {
        return;
    }
    item.phase = 'paused';
    item.paused_at = Date.now();
    ctx.log('transfer_paused', {id: item.id, bytes: item.received});
    await new Promise(function (resolve) {
        item.wake = function () {
            delete item.wake;
            resolve();
        };
    });
    item.paused_ms += Date.now() - item.paused_at;
    item.paused_at = null;
    item.phase = 'copying';
    if (item.cancelled === false) {
        ctx.log('transfer_resumed', {id: item.id});
    }
}

// A copy that reaches the next step paused stops there, as a part cut by Pause does
function paused_throw(queue)
{
    if (queue.paused) {
        throw new Error('the copy was paused');
    }
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

// The speed across one copy while it runs: every second, how fast the last three seconds went
// (y) at how far the copy has come (x). A copy that carries on from where a drop left it goes
// back with the graph, never over itself. Answers with the function that stops it.
function sampler_start(item)
{
    const seen = [];
    const timer = setInterval(function () {
        if ((item.size === null) || (item.size === 0) || (item.phase !== 'copying')) {
            seen.length = 0;
            return;
        }
        const now = Date.now();
        seen.push([now, item.received]);
        while ((seen.length > 1) && (now - seen[0][0] > SAMPLE_SPAN_MS)) {
            seen.shift();
        }
        if (seen.length < 2) {
            return;
        }
        const speed = Math.max(0, (item.received - seen[0][1])*1000/(now - seen[0][0]));
        const x = Math.min(1, item.received/item.size);
        const samples = item.samples.filter(v => v.x <= x);
        samples.push({x, y: speed});
        item.samples = (samples.length > SAMPLES_MAX) ? samples.filter((v, index) => (index % 2 === 0)) : samples;
    }, SAMPLE_MS);
    timer.unref();
    return function () {
        clearInterval(timer);
    };
}

// What a part on its way has carried before the disk took it
function piece_flowing(piece)
{
    return (piece.flowing === undefined) ? 0 : piece.flowing;
}

module.exports = transfer_queue;
