const agent_logline_path = require('./agent_logline_path');
const file_write_synced = require('./file_write_synced');
const fs = require('fs');
const logline_line_cut = require('./logline_line_cut');
const logline_time_strip = require('./logline_time_strip');
const os = require('os');
const path = require('path');

const SCAN_MS = 1000;
const READ_BYTES = 1024*1024;
// What is not a log to read line by line: compressed, or rotated away and packed up
const RE_SKIPPED = /\.(gz|xz|bz2|zst|zip|lz4|7z)$/i;

// The files of some folders, into the spool, a line at a time as they are written. A folder is
// a path — every file in it — or a path whose last part is a pattern, /var/log/nginx/*.log.
//
// A file is known by what the disk calls it, device and inode, not by its name: a file
// renamed by logrotate is the same file, and a new one under the old name is a new one. Where
// its reading stood is the spool's own word — the byte offset after its last line held — so a
// restart goes on from there. A file shorter than that was truncated in place: it is read
// again from its start, its lines under a key of their own.
//
// Nothing from before the floor: a file already there when its folder is first watched is read
// from where it ends at that moment, and one that appears after is read from its start. Which
// files were there is kept in files.json, so a restart does not take a file that arrived while
// the agent was away for one that was always there.
//
// ctx: {spool, host, dirs, floor, say} -> {stop, files, errors}
function logline_files(ctx)
{
    const run = {running: true, timer: null, seen: seen_read(ctx.floor), files: 0, errors: {}};
    function tick() {
        if (run.running === false) {
            return;
        }
        try {
            scan(ctx, run);
        }
        catch (error) {
            ctx.say('logline_files_error', {reason: error.message, then: 'read again in a second'});
        }
        run.timer = setTimeout(tick, SCAN_MS);
        run.timer.unref();
    }
    tick();
    return {
        stop: function () {
            run.running = false;
            clearTimeout(run.timer);
        },
        files: () => run.files,
        errors: () => run.errors,
    };
}

function scan(ctx, run)
{
    let count = 0;
    let changed = false;
    for (const dir of ctx.dirs) {
        let found;
        try {
            found = files_of(dir.path);
            delete run.errors[dir.path];
        }
        catch (error) {
            if (run.errors[dir.path] !== error.message) {
                ctx.say('logline_dir_error', {dir: dir.path, reason: error.message, then: 'looked at again every second'});
            }
            run.errors[dir.path] = error.message;
            continue;
        }
        // The first look at a folder: what is in it now is from before, and is read from its end
        const first = (run.seen.dirs.includes(dir.path) === false);
        for (const file of found) {
            const id = `${file.stat.dev}:${file.stat.ino}`;
            if (run.seen.files[id] === undefined) {
                run.seen.files[id] = {start: first ? file.stat.size : 0, cut: 0};
                changed = true;
            }
            count += 1;
            if (ctx.spool.full()) {
                continue;
            }
            // A file cut short is a new run of lines in the same file: counted under a key of
            // its own, so where the old run stood no longer applies
            const seen = run.seen.files[id];
            if (file_read(ctx, dir, file, key_of(ctx, id, seen.cut), seen.start) === 'truncated') {
                run.seen.files[id] = {start: 0, cut: seen.cut + 1};
                changed = true;
                file_read(ctx, dir, file, key_of(ctx, id, seen.cut + 1), 0);
            }
        }
        if (first) {
            run.seen.dirs.push(dir.path);
            changed = true;
        }
    }
    run.files = count;
    if (changed) {
        file_write_synced(agent_logline_path('files.json'), JSON.stringify(run.seen));
    }
}

// The key a file's lines are held under: the file, which run of lines in it, and the floor —
// so neither a truncation nor switching off and on again ever meets where an old run stood
function key_of(ctx, id, cut)
{
    return `file:${id}:${cut}@${ctx.floor}`;
}

// The files a folder or a pattern names: [{path, stat}], regular files only
function files_of(written)
{
    // ~/ is the home of whoever runs the agent
    const pattern = written.startsWith('~/') ? path.join(os.homedir(), written.slice(2)) : written;
    const base = path.basename(pattern);
    const glob = base.includes('*');
    const dir = glob ? path.dirname(pattern) : pattern;
    const re = glob ? new RegExp(`^${base.split('*').map(v => v.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`) : null;
    const out = [];
    for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('.') || RE_SKIPPED.test(name) || ((re !== null) && (re.test(name) === false))) {
            continue;
        }
        const full = path.join(dir, name);
        let stat;
        try {
            stat = fs.statSync(full);
        }
        catch {
            // Gone between the listing and the look
            continue;
        }
        if (stat.isFile()) {
            out.push({path: full, stat});
        }
    }
    out.sort((a, b) => (a.path < b.path) ? -1 : 1);
    return out;
}

// Whatever whole lines a file has past where its reading stood; a line still being written —
// no newline yet — waits for the next look
function file_read(ctx, dir, file, key, start)
{
    const kept = ctx.spool.cursor(key);
    // Where it stood, and never before where this collection began with it: a cursor from an
    // earlier time the machine was switched on does not bring back what was written while off
    let offset = Math.max(start, (kept === null) ? 0 : parseInt(kept.at, 10));
    if (file.stat.size < offset) {
        ctx.say('logline_file_truncated', {file: file.path, was: offset, now: file.stat.size, then: 'read from its start'});
        return 'truncated';
    }
    if (file.stat.size === offset) {
        return 'read';
    }
    const fd = fs.openSync(file.path, 'r');
    try {
        while ((offset < file.stat.size) && (ctx.spool.full() === false)) {
            const chunk = Buffer.alloc(Math.min(READ_BYTES, file.stat.size - offset));
            const got = fs.readSync(fd, chunk, 0, chunk.length, offset);
            if (got === 0) {
                return 'read';
            }
            let start_at = 0;
            let newline = chunk.indexOf(10, 0);
            if ((newline === -1) && (got === READ_BYTES)) {
                // A line longer than a whole read: taken as it is, cut the rules' way
                line_keep(ctx, dir, file, key, chunk.subarray(0, got), offset + got);
                offset += got;
                continue;
            }
            while ((newline !== -1) && (newline < got)) {
                line_keep(ctx, dir, file, key, chunk.subarray(start_at, newline), offset + newline + 1);
                start_at = newline + 1;
                newline = chunk.indexOf(10, start_at);
            }
            if (start_at === 0) {
                return 'read';
            }
            offset += start_at;
        }
    }
    finally {
        fs.closeSync(fd);
    }
    return 'read';
}

function line_keep(ctx, dir, file, key, bytes, offset)
{
    const stripped = logline_time_strip(bytes.toString('utf8').trimEnd());
    ctx.spool.append({
        src: key,
        // The offset past the line, padded so offsets compare as text, the way stamps do
        at: String(offset).padStart(16, '0'),
        time: (stripped.time === null) ? new Date().toISOString() : stripped.time,
        labels: {
            host: ctx.host,
            service: ((dir.service === null) || (dir.service === '')) ? path.basename(dir.path.includes('*') ? path.dirname(dir.path) : dir.path) : dir.service,
            file: file.path,
        },
        line: logline_line_cut(stripped.line),
    });
}

// What files.json says for this floor. Switched off and on again is a new floor, and then
// nothing seen before counts: every folder is looked at for the first time again.
function seen_read(floor)
{
    try {
        const seen = JSON.parse(fs.readFileSync(agent_logline_path('files.json'), 'utf8'));
        if (seen.floor === floor) {
            return {floor, dirs: seen.dirs || [], files: seen.files || {}};
        }
    }
    catch {
        // Never written, or not readable: nothing was seen
    }
    return {floor, dirs: [], files: {}};
}

module.exports = logline_files;
