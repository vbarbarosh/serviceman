const crypto = require('crypto');
const object_from_line = require('../../../src/helpers/object_from_line');
const path = require('path');
const stream = require('stream');
const tar_parser = require('./tar_parser');

// A part of a copy between two disks. The link to a disk has no body limit, so a part is only
// how much a dropped connection costs.
const PART_BYTES = 32*1024*1024;

// The longest pause between two tries, in seconds; the first is one, then two, four…
const RETRY_MAX_S = 30;

// Errors that trying again will not change: a file that is not there, or may not be read, or
// got shorter than it was weighed, a walk that names a path outside its folder. An error that
// says so itself, error.lasting, is one too: a host that cannot keep a disk within a folder, a
// path that leads out of the folder.
const RE_LASTING = /ENOENT|EACCES|EPERM|EISDIR|ENOTDIR|ENOSPC|a name of its own|not copied yet|into itself|cannot list a whole tree|is there already|no path under it|got shorter while it was copied/;

// What a disk kept within a folder says of a path that is not inside it (disk_kept): EACCES,
// the path as JSON, `is outside`. A file that may not be written says EACCES in other words.
const RE_OUTSIDE = /EACCES: ("(?:[^"\\]|\\.)*") is outside\b/;

// A file of a folder up to this size goes with others in one tar; a bigger one goes alone, in
// parts, so a link that drops costs a part of it and not the whole. A file no bigger than a part
// would go in one part anyway, and alone it costs three calls and a pause between it and the
// next: a folder of songs went one at a time.
const SMALL_FILE_BYTES = 32*1024*1024;
// How much one tar of small files carries at most, in bytes and in names
const BATCH_BYTES = 64*1024*1024;
const BATCH_NAMES = 1000;
// The names left out of a folder's copy that are kept by name; past these, only counted
const LEFT_KEPT = 20;
// How much of a path a walk's refusal says: the reason is kept with the copy, logged, and sent
// to every page that lists the copies, and a walk may name a path of any length
const PATH_SAID_CHARS = 200;

// How much older than its finish a file may look and still be the one that finish made
const FINISH_SLACK_MS = 10*60*1000;

// How long the bytes of a copy may stand still before the step is cut and tried again, as a
// dropped link would cut it. A link that stays up and carries nothing never fails by itself:
// a copy waited on one for minutes, Pause and Cancel its only way out. Uploads from a page
// wait as long (upload_queue).
const STALL_MS = 30*1000;

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
//     disk_of(name, within)   the disk of that name, or null while it cannot be reached. With
//                          `within`, a folder, the same disk kept within it, for a folder's
//                          copy (disk_kept); a host that cannot keep it so throws, saying why
//     log(event, fields)   what was done, for the host's own log
//     part_bytes           how big a part is; 32 MB by default
//     small_bytes          how big a file of a folder may be and still go in a tar; 32 MB
//     stall_ms             how long its bytes may stand still before a step is cut; 30 s
//
// A disk may say what its agent does already, can(feature): a disk without can, or one that
// cannot do folder_copy, gets a folder file by file, without its links. A disk that writes
// bytes may say how many of them it took, as they go: write_tar(dir, source, taken) and
// part_write(..., source, taken) call taken(bytes). Bytes coming in or bytes taken, either is
// the copy moving; neither for stall_ms, and the step is cut and goes on from where it stood.
//
// The queue is {items, paused, add(from, to), cancel(id), clear(), pause(), resume()}, where
// from is {disk, path} and to is {disk, dir}.
function transfer_queue(options)
{
    const log = (options.log === undefined) ? function () {} : options.log;
    const out = {items: [], running: false, paused: false};
    const ctx = {
        disk_of: options.disk_of,
        log,
        part_bytes: (options.part_bytes === undefined) ? PART_BYTES : options.part_bytes,
        small_bytes: (options.small_bytes === undefined) ? SMALL_FILE_BYTES : options.small_bytes,
        stall_ms: (options.stall_ms === undefined) ? STALL_MS : options.stall_ms,
        queue: out,
        weighed: Promise.resolve(),
    };
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
        // The file on its way: {from_path, dir, name, path, id, size, mode, received,
        // finish_sent_at}; dir and path as the disk it is written through is told them
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
                await folder_copy(item, from, to, disk_kept(disk_of, item, folder_of(item)), ctx, progressed);
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
            if ((error.lasting === true) || RE_LASTING.test(error.message)) {
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
    // What came of the file on its way goes: a part of a file is nobody's file. It is asked of
    // the disk the part was written through, and stays when that disk is away.
    if (item.piece === null) {
        return;
    }
    let to;
    try {
        to = (item.kind === 'dir') ? disk_kept(disk_of, item, folder_of(item)) : disk_or_throw(disk_of, item.to.disk);
    }
    catch {
        return;
    }
    to.part_remove(item.piece.dir, item.piece.name, item.piece.id).catch(function () {});
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
        return {path: piece.path};
    }
    while ((piece.received < piece.size) && (item.cancelled === false)) {
        paused_throw(ctx.queue);
        const start = piece.received;
        const last = Math.min(piece.size, start + ctx.part_bytes) - 1;
        const source = from.read(piece.from_path, {start, end: last});
        // What the part has carried so far counts as it goes, so a big file's copy moves
        // smoothly and not a part at a time; a part that fails is read again from the disk's
        // word. Counted on the way through, never by listening: a listener would set the bytes
        // flowing before the disk is there to take them.
        piece.flowing = 0;
        const watch = stall_watch(item, ctx, {step: 'part', path: piece.from_path}, function (error) {
            source.destroy(error);
            counted.destroy(error);
        });
        const counted = new stream.Transform({
            transform: function (chunk, encoding, callback) {
                piece.flowing += chunk.length;
                watch.read(chunk.length);
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
        let carried = 0;
        try {
            piece.received = (await to.part_write(piece.dir, piece.name, piece.id, piece.received, counted, watch.taken)).received;
            carried = piece.flowing;
        }
        finally {
            watch.stop();
            piece.flowing = 0;
            delete item.abort;
        }
        moved();
        // A part whose read ended with no error, short of its last byte, ended where the file
        // ends: bytes that have not come yet keep a read open until the stall cuts it, and a
        // link that drops fails it. Asked again, the next part would start where the file ends
        // and bring nothing, at once and for ever: a log cut while it was copied kept three
        // processes busy, and every copy behind it waiting. So the copy ends here, for good
        // (RE_LASTING), whatever the file holds now: what is in came from the file as it was,
        // and the rest would come from another, a file that looks whole and is not. Its part
        // stays a part, as a failed copy's does, and nothing lands under its name; a folder
        // leaves the file out and says so.
        if (start + carried <= last) {
            throw new Error(`the file got shorter while it was copied: it had ${piece.size} bytes when the copy began, and ended at ${start + carried}`);
        }
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
        item.piece = {from_path: item.from.path, dir: item.to.dir, name: item.name, path: path.posix.join(item.to.dir, item.name), id: item.id, size: stat.size, mode: stat.mode, received: 0, finish_sent_at: null};
        item.kind = stat.kind;
        item.size = stat.size;
        return;
    }
    folder_check(item);
    // A disk that cannot be kept within the folder says so before the folder is walked
    disk_kept(ctx.disk_of, item, folder_of(item));
    item.kind = 'dir';
    const walk = await walk_read(item, from, item.from.path, ctx);
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
// files, the big files one by one, and the links. Its folders and files are written through
// `kept`, the disk kept within the folder the copy makes, each path told from that folder
// (kept_path): a name that leads out of it ends the copy (outside_error). The folder itself is
// made through the disk kept within the folder copied into, so a link under the folder's own
// name, one a copy before may have made, is not followed out of there either.
async function folder_copy(item, from, to, kept, ctx, progressed)
{
    const root = folder_of(item);
    const walk = item.walk;
    while ((walk.at < walk.steps.length) && (item.cancelled === false)) {
        paused_throw(ctx.queue);
        const step = walk.steps[walk.at];
        if (step.kind === 'root') {
            try {
                await disk_kept(ctx.disk_of, item, (item.to.dir === '') ? '.' : item.to.dir).mkdir(kept_path(item.name));
            }
            catch (error) {
                throw outside_error(item, '', error);
            }
        }
        else if (step.kind === 'dirs') {
            for (; step.done < step.names.length; step.done++) {
                try {
                    await kept.mkdir(kept_path(step.names[step.done]));
                }
                catch (error) {
                    throw outside_error(item, step.names[step.done], error);
                }
            }
        }
        else if (step.kind === 'tar') {
            try {
                await tar_copy(item, step, from, kept, ctx, progressed);
            }
            catch (error) {
                // A tar cut by Pause goes again whole: the files it had landed are written over.
                // So does one that stood still the first time: the link stood, not its files.
                if (ctx.queue.paused || ((error.stalled === true) && (step.stalled !== true))) {
                    step.stalled = (error.stalled === true);
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
                // A name of the tar that leads out of the folder ends the copy, as a file's does
                throw outside_error(item, null, error);
            }
        }
        else if (step.kind === 'file') {
            if (await file_step(item, step, from, kept, ctx, progressed) === false) {
                break;
            }
        }
        else if (step.kind === 'links') {
            // A link is made as itself and never followed, so what is held to the folder is
            // where it stands: its own folder, made through the kept disk first, once for the
            // links that stand side by side. The link is then asked of the disk itself: kept
            // within the folder, it would refuse a link that is there already and points out
            // of it, as a link may.
            let held = null;
            for (; step.done < step.links.length; step.done++) {
                const link = step.links[step.done];
                const dir = path.posix.dirname(link.path);
                try {
                    if (dir !== held) {
                        await kept.mkdir(kept_path(dir));
                        held = dir;
                    }
                    await to.link_create(`${root}/${link.path}`, link.target);
                }
                catch (error) {
                    const refusal = outside_error(item, link.path, error);
                    if ((refusal.lasting === true) || (RE_LASTING.test(error.message) === false)) {
                        throw refusal;
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

// One big file of a folder, in parts, through the disk kept within the folder. One that cannot
// be read is left out, and the folder goes on; one that leads out of the folder ends the copy;
// false when the copy was given up on the way.
async function file_step(item, step, from, kept, ctx, progressed)
{
    const walk = item.walk;
    const file = step.file;
    if ((item.piece === null) || (item.piece.from_path !== path.posix.join(item.from.path, file.path))) {
        item.piece = {
            from_path: path.posix.join(item.from.path, file.path),
            dir: kept_path(path.posix.dirname(file.path)),
            name: path.posix.basename(file.path),
            path: kept_path(file.path),
            id: `${item.id}f${walk.at}`,
            size: file.size,
            mode: file.mode,
            received: 0,
            finish_sent_at: null,
        };
    }
    try {
        const landed = await piece_copy(item, item.piece, from, kept, ctx, function () {
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
        const refusal = outside_error(item, file.path, error);
        if ((refusal.lasting === true) || (RE_LASTING.test(error.message) === false)) {
            throw refusal;
        }
        left_add(item, file.path, error.message);
        step.left = true;
    }
    item.piece = null;
    return true;
}

// Small files of a folder as one tar, read on one disk and written on the other as it comes;
// what it has carried so far counts toward the copy, its headers aside. The tar is of the
// folder itself and is written into the folder the copy makes, through the disk kept within
// it: whatever names the tar carries, they are held under that folder, and none lands beside
// it. The line under the copy names the file on its way and how far that file is, read from the
// tar's own headers as they pass: a tar is files one after another, and the one going is the
// one to show.
async function tar_copy(item, step, from, kept, ctx, progressed)
{
    const walk = item.walk;
    const names = step.files.map(v => v.path).concat(step.dirs);
    const source = from.tar(item.from.path, names, {paths: true});
    const parser = tar_parser();
    let following = true;
    let carried = 0;
    item.now = (step.files.length > 0) ? {label: `${item.name}/${step.files[0].path}`, size: step.files[0].size, done: 0} : {label: `${item.name}/${step.dirs[0]}/`, size: null, done: 0};
    const watch = stall_watch(item, ctx, {step: 'tar', files: step.files.length, bytes: step.bytes}, function (error) {
        source.destroy(error);
    });
    source.on('data', function (chunk) {
        carried += chunk.length;
        watch.read(chunk.length);
        item.received = walk.bytes_done + Math.min(step.bytes, carried);
        following = following && tar_now(item, parser, chunk);
    });
    // Cancel and Pause end the tar at once: the files that were whole stay, the one on its
    // way goes
    item.abort = function () {
        source.destroy(new Error('the copy was stopped'));
    };
    try {
        await kept.write_tar(kept_path(''), source, watch.taken);
    }
    finally {
        watch.stop();
        delete item.abort;
    }
    progressed();
}

// The file a tar carries now, by its own header, as the copy's line: {label, size, done}, a
// folder named as itself, each under the folder's name as a file alone is. False once the bytes
// are no tar it can follow; the line then keeps the last name it had, and the far end says what
// is wrong with them.
function tar_now(item, parser, chunk)
{
    let pieces;
    try {
        pieces = parser.push(chunk);
    }
    catch {
        return false;
    }
    for (const piece of pieces) {
        if (piece.type === 'file') {
            item.now = {label: `${item.name}/${piece.name}`, size: piece.size, done: 0};
        }
        else if ((piece.type === 'data') && (item.now !== null)) {
            item.now.done += piece.bytes.length;
        }
        else if (piece.type === 'dir') {
            item.now = {label: `${item.name}/${piece.name}/`, size: null, done: 0};
        }
    }
    return true;
}

// Every name under a folder, as the disk it is on walks it: {files, dirs, links, others,
// unread}, each path relative to the folder. A walk that stands still is cut as a copy is; one
// that names a path that is not under the folder fails whole (line_refusal).
function walk_read(item, disk, dir, ctx)
{
    if (disk.tree === undefined) {
        return Promise.reject(new Error('this disk cannot list a whole tree'));
    }
    return new Promise(function (resolve, reject) {
        const walk = {files: [], dirs: [], links: [], others: [], unread: []};
        const stream = disk.tree(dir, {hash: false, skip: []});
        const watch = stall_watch(item, ctx, {step: 'walk', path: dir}, function (error) {
            stream.destroy(error);
        });
        stream.on('close', watch.stop);
        let rest = '';
        let ended = false;
        stream.on('data', function (chunk) {
            watch.read(chunk.length);
            const lines = (rest + chunk.toString('utf8')).split('\n');
            rest = lines.pop();
            for (const text of lines) {
                if (text.trim() === '') {
                    continue;
                }
                const line = object_from_line(text);
                if (line === null) {
                    stream.destroy(new Error('the disk said a line that is no JSON object'));
                    return;
                }
                const refusal = line_refusal(item, line);
                if (refusal !== null) {
                    stream.destroy(new Error(refusal));
                    return;
                }
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
        stream.on('error', function (error) {
            watch.stop();
            reject(error);
        });
        stream.on('end', function () {
            watch.stop();
            if (ended === false) {
                reject(new Error('the walk of the folder stopped short'));
                return;
            }
            resolve(walk);
        });
    });
}

// Why a line of the walk is not taken, or null when it is. The walk is the word of the disk the
// folder is on, and the copy makes, writes and links under every path of it on the other disk:
// so a path is one under the folder, written the one way a walk writes it. That is the rule a
// tar's names are held to (tar_parser), with nothing for the rule to tidy: no root, no `..`,
// no `.` and no empty part. The folder itself, the empty path, is what an error alone names: a
// folder that could not be read. One refusal fails the walk and the copy for good, before
// anything is written: a disk that named one such path is not trusted with the rest.
//
// A link's target is not checked: it is not a path of the copy but the link's own text, kept as
// it was, and a link may point anywhere (`../lib`, `/etc/hosts`). No file of this copy is
// written through it, the links being made last (steps_of), and none of a later copy, the disk
// copied to being kept within the folder (disk_kept).
function line_refusal(item, line)
{
    if (['file', 'dir', 'link', 'other', 'error'].includes(line.type) === false) {
        return null;
    }
    try {
        if ((typeof line.path === 'string') && ((line.path !== '') || (line.type === 'error')) && (tar_parser.name_checked(line.path) === line.path)) {
            return null;
        }
    }
    catch {
        // The rule's own refusal, an absolute path or one with `..`: said below, as a walk's
    }
    return `${item.from.disk} walked the folder and named ${path_said(line.path)}, which is no path under it: nothing was copied`;
}

// A path as a refusal says it: as JSON, so one with a line break stays one line, and cut when
// it is longer than a refusal should be
function path_said(value)
{
    const text = String(JSON.stringify(value));
    return (text.length > PATH_SAID_CHARS) ? `${text.slice(0, PATH_SAID_CHARS)}…` : text;
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

// The folder a folder's copy makes, `<dir>/<name>`, as the disk it is on is told it. A folder
// called `~` copied into a folder written without a root is a name there, and nobody's home.
function folder_of(item)
{
    const joined = path.posix.join(item.to.dir, item.name);
    return (joined.startsWith('~') && (item.to.dir.startsWith('~') === false)) ? `./${joined}` : joined;
}

// The disk a folder's copy is written through: the one of that name the host keeps within a
// folder, the one the copy makes (folder_of), or the one copied into for the folder itself.
// That folder is where the kept disk starts, a path is told to it from there (kept_path), and
// it refuses, with EACCES, the path and the words `is outside`, whatever a path names, through
// links too, that is not inside the folder. So nothing the disk copied from says, a walk's path
// or a tar's name, and no link already there, takes a write of the copy out of its folder. A
// host that cannot keep the disk so throws and says why, and the copy ends with its words:
// waiting changes nothing there.
function disk_kept(disk_of, item, within)
{
    let out;
    try {
        out = disk_of(item.to.disk, within);
    }
    catch (error) {
        error.lasting = true;
        throw error;
    }
    if (out === null) {
        throw new Error(`${item.to.disk} cannot be reached`);
    }
    return out;
}

// A path of a folder's copy as the disk kept within the folder is told it: from the folder,
// `.` being the folder itself. Written so, a name is a name whatever it looks like: a folder
// called `~` is not the home, as `./-x` is no option to tar.
function kept_path(rel)
{
    return ((rel === '') || (rel === '.')) ? '.' : `./${rel}`;
}

// What a failed write of a folder's copy ends with. When the kept disk refused the path as one
// outside the folder, it is the copy's own words, for good: the name is under the folder, so
// it is a link there that leads out, one a copy before may have made, or the owner. The copy
// stops rather than leaving the name out: the disk copied from named what the other would
// not write. `rel` is the path under the folder, said in full, under the folder copied into;
// null for a name of a tar, which only the disk has read: the path is then the one its refusal
// names; and '' for the folder itself, whose name leads out of the folder copied into. Any
// other error is passed on as it came. The words that say what happened come first, the path
// after them: a page shows the start of a long line.
function outside_error(item, rel, error)
{
    const found = RE_OUTSIDE.exec(error.message);
    if (found === null) {
        return error;
    }
    let said = `on ${item.to.disk} the name ${item.name} leads out of the folder copied into, ${path_said(item.to.dir)}: nothing was copied`;
    if (rel !== '') {
        said = `a link on ${item.to.disk} leads out of ${item.name}, the folder being copied: ${path_said((rel === null) ? path_named(found[1]) : `${folder_of(item)}/${rel}`)} lies outside it, and the copy stopped`;
    }
    const out = new Error(said);
    out.lasting = true;
    return out;
}

// The path a kept disk's refusal names: written there as JSON, and said as it is written when
// it is none
function path_named(text)
{
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
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
        stat = await to.stat(piece.path);
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

// A step's bytes, watched from both ends: read(bytes) as they come from the disk they are on,
// taken(bytes) as the disk they go to says it took them. When neither has moved for stall_ms,
// cut(error) ends the step with an error that says so, error.stalled, and a line says how far
// each end got: the end that stood is the one to look at. Answers {read, taken, stop}.
function stall_watch(item, ctx, words, cut)
{
    const seen = {read: 0, taken: 0, moved_at: Date.now()};
    const timer = setInterval(function () {
        const still_ms = Date.now() - seen.moved_at;
        if (still_ms < ctx.stall_ms) {
            return;
        }
        clearInterval(timer);
        const error = new Error(`nothing moved for ${Math.round(still_ms/1000)}s`);
        error.stalled = true;
        ctx.log('transfer_stalled', Object.assign({id: item.id, from: item.from.disk, to: item.to.disk}, words, {read: seen.read, taken: seen.taken, still: `${Math.round(still_ms/1000)}s`}));
        cut(error);
    }, Math.min(1000, ctx.stall_ms));
    // A copy that stands still does not keep the process alive
    timer.unref();
    return {
        read: function (bytes) {
            seen.read += bytes;
            seen.moved_at = Date.now();
        },
        taken: function (bytes) {
            seen.taken += bytes;
            seen.moved_at = Date.now();
        },
        stop: function () {
            clearInterval(timer);
        },
    };
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
