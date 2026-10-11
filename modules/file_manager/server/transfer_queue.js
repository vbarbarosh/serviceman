const crypto = require('crypto');
const path = require('path');

// A part of a copy between two disks. The link to a disk has no body limit, so a part is only
// how much a dropped connection costs.
const PART_BYTES = 32*1024*1024;

// The longest pause between two tries, in seconds; the first is one, then two, four…
const RETRY_MAX_S = 30;

// Errors that trying again will not change: a file that is not there, or may not be read
const RE_LASTING = /ENOENT|EACCES|EPERM|EISDIR|ENOTDIR|ENOSPC|a name of its own|not copied yet/;

// How much older than its finish a file may look and still be the one that finish made
const FINISH_SLACK_MS = 10*60*1000;

// Copies of files from one disk to another, run by the server and not by a page: a page may
// close, the copy goes on. One copy at a time, in the order they were asked for; each goes in
// parts, and a disk that drops is waited for and asked where the file stands, so the copy
// carries on from there.
//
//     options = {disk_of, log, part_bytes}
//     disk_of(name)        the disk of that name, or null while it cannot be reached
//     log(event, fields)   what was done, for the host's own log
//     part_bytes           how big a part is; 32 MB by default
//
// The queue is {items, add(from, to), cancel(id), clear()}, where from is {disk, path} and to
// is {disk, dir}.
function transfer_queue(options)
{
    const log = ((options.log === undefined) ? function () {} : options.log);
    const ctx = {disk_of: options.disk_of, log, part_bytes: ((options.part_bytes === undefined) ? PART_BYTES : options.part_bytes)};
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
        return true;
    };
    // What is over is taken off the list; what is still on its way stays
    out.clear = function () {
        out.items = out.items.filter(v => (v.phase === 'waiting') || (v.phase === 'copying') || (v.phase === 'retrying'));
    };
    return out;
}

// One copy as the queue keeps it, before it starts
function item_make(from, to)
{
    return {
        id: crypto.randomBytes(8).toString('hex'),
        from: {disk: String(from.disk), path: String(from.path)},
        to: {disk: String(to.disk), dir: String(to.dir)},
        name: path.posix.basename(String(from.path)),
        size: null,
        received: 0,
        began_at: null,
        began_ms: null,
        phase: 'waiting',
        said: '',
        wait_s: 0,
        path: null,
        cancelled: false,
        finish_sent_at: null,
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
        }
    }
    finally {
        queue.running = false;
    }
}

// One file, part after part, from where the disk it goes to says it stands
async function transfer_run(item, ctx)
{
    const disk_of = ctx.disk_of;
    const log = ctx.log;
    item.phase = 'copying';
    item.began_ms = Date.now();
    log('transfer_begin', {id: item.id, from: item.from.disk, path: item.from.path, to: item.to.disk, dir: item.to.dir});
    let failures = 0;
    while (item.cancelled === false) {
        try {
            const from = disk_or_throw(disk_of, item.from.disk);
            const to = disk_or_throw(disk_of, item.to.disk);
            if (item.size === null) {
                const stat = await from.stat(item.from.path);
                if (stat.kind === 'dir') {
                    throw new Error('folders are not copied yet');
                }
                item.size = stat.size;
            }
            item.received = (await to.part_stat(item.to.dir, item.name, item.id)).received;
            if (item.began_at === null) {
                item.began_at = item.received;
            }
            if (await finished_already(item, to)) {
                break;
            }
            while ((item.received < item.size) && (item.cancelled === false)) {
                const end = Math.min(item.size, item.received + ctx.part_bytes) - 1;
                const source = from.read(item.from.path, {start: item.received, end});
                item.received = (await to.part_write(item.to.dir, item.name, item.id, item.received, source)).received;
                failures = 0;
            }
            if (item.cancelled) {
                break;
            }
            item.finish_sent_at = Date.now();
            const landed = await to.part_finish(item.to.dir, item.name, item.id, item.size);
            item.path = landed.path;
            item.phase = 'ok';
            log('transfer_end_ok', {id: item.id, path: landed.path, bytes: landed.bytes});
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
    log('transfer_cancelled', {id: item.id});
    // What came of it goes: a part of a file is nobody's file
    const to = disk_of(item.to.disk);
    if (to !== null) {
        to.part_remove(item.to.dir, item.name, item.id).catch(function () {});
    }
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
async function finished_already(item, to)
{
    if ((item.received !== 0) || (item.finish_sent_at === null)) {
        return false;
    }
    const full = path.posix.join(item.to.dir, item.name);
    let stat;
    try {
        stat = await to.stat(full);
    }
    catch {
        return false;
    }
    if ((stat.size !== item.size) || (stat.mtime_ms < item.finish_sent_at - FINISH_SLACK_MS)) {
        return false;
    }
    item.received = item.size;
    item.path = full;
    item.phase = 'ok';
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
