const file_write_synced = require('./file_write_synced');
const fs = require('fs');
const path = require('path');

const SEGMENT_BYTES = 16*1024*1024;
const SYNC_MS = 200;
const READ_BYTES = 2*1024*1024;
// Collection goes on again once the spool is this far under its cap, not the moment one batch
// leaves: a machine at its cap would otherwise stop and start with every batch
const ROOM_AT = 0.9;
const RE_SEGMENT = /^(\d{16})\.jsonl$/;

// The lines on their way to Logline, on this machine's disk. A line counts as collected once it
// is synced here, and leaves only after Logline has said it has it.
//
//     segments   0000000000000001.jsonl …   one record a line, append-only, 16M each
//     acked.json                            the last seq Logline has
//     inflight.json                         the batch being sent: sent again, the same, until acked
//     cursors.json                          where each container was, at the end of what was deleted
//
// The spool is its own cursor: where a container's reading stood is read back from the records
// themselves, so there is no second file to fall out of step with them. What a deleted segment
// knew is kept in cursors.json, with the last seq it covers, so nothing is counted twice.
//
// options: {cap_bytes, segment_bytes, sync_ms, on_data}
function logline_spool(dir, options)
{
    fs.mkdirSync(dir, {recursive: true, mode: 0o700});
    const spool = {
        dir,
        cap_bytes: options.cap_bytes,
        // A segment goes only when all of it is acked, so a small cap gets small segments
        segment_bytes: ((options.segment_bytes === undefined) ? Math.max(4096, Math.min(SEGMENT_BYTES, Math.floor(options.cap_bytes/8))) : options.segment_bytes),
        on_data: options.on_data || nothing,
        segments: [],
        buffer: [],
        fd: null,
        next_seq: 1,
        acked: 0,
        inflight: null,
        cursors: {},
        deleted: {upto: 0, cursors: {}},
        reader: null,
        waiting_bytes: 0,
        room_waiters: [],
        timer: null,
    };
    recover(spool);
    spool.timer = setInterval(function () {
        flush(spool);
    }, ((options.sync_ms === undefined) ? SYNC_MS : options.sync_ms));
    spool.timer.unref();
    return {
        append: v => append(spool, v),
        flush: () => flush(spool),
        batch: (max_items, max_bytes) => batch(spool, max_items, max_bytes),
        ack: v => ack(spool, v),
        cursor: v => ((spool.cursors[v] === undefined) ? null : spool.cursors[v]),
        full: () => full(spool),
        room: () => room(spool),
        stats: () => stats(spool),
        close: () => close(spool),
    };
}

// A record: {src, at, time, labels, line}. It is given its seq and waits in memory for the next
// sync — which is at most 200ms off, and is what makes it collected.
function append(spool, record)
{
    const item = {seq: spool.next_seq, src: record.src, at: record.at, time: record.time, labels: record.labels, line: record.line};
    spool.next_seq += 1;
    const text = `${JSON.stringify(item)}\n`;
    spool.buffer.push(text);
    spool.waiting_bytes += Buffer.byteLength(text);
    cursor_apply(spool.cursors, item);
    return item.seq;
}

// Everything in memory, onto the disk and synced
function flush(spool)
{
    if (spool.buffer.length === 0) {
        return;
    }
    const text = spool.buffer.join('');
    const first_seq = spool.next_seq - spool.buffer.length;
    spool.buffer = [];
    let segment = spool.segments[spool.segments.length - 1];
    if ((segment === undefined) || segment.closed) {
        segment = {name: `${String(first_seq).padStart(16, '0')}.jsonl`, first: first_seq, last: first_seq - 1, size: 0, closed: false, cursors_at_end: null};
        spool.segments.push(segment);
        spool.fd = fs.openSync(path.join(spool.dir, segment.name), 'a', 0o600);
        dir_sync(spool.dir);
    }
    const bytes = Buffer.from(text);
    fs.writeSync(spool.fd, bytes);
    fs.fdatasyncSync(spool.fd);
    segment.size += bytes.length;
    segment.last = spool.next_seq - 1;
    if (spool.reader === null) {
        spool.reader = {segment: spool.segments.indexOf(segment), offset: segment.size - bytes.length, seq: first_seq};
    }
    if (segment.size >= spool.segment_bytes) {
        segment_close(spool, segment);
    }
    spool.on_data();
}

function segment_close(spool, segment)
{
    fs.closeSync(spool.fd);
    spool.fd = null;
    segment.closed = true;
    segment.cursors_at_end = JSON.parse(JSON.stringify(spool.cursors));
}

// The records waiting to be sent, from the oldest, up to either limit: {first, last, body,
// count, bytes, end}. The batch being sent is remembered, on disk too, and asked for again it is
// the same batch — the same bytes, so Logline stores it once however often it comes.
function batch(spool, max_items, max_bytes)
{
    if (spool.reader === null) {
        return null;
    }
    const wanted = spool.inflight;
    const items = [];
    const at = {segment: spool.reader.segment, offset: spool.reader.offset};
    let first = null;
    let last = null;
    let bytes = 0;
    while (at.segment < spool.segments.length) {
        const segment = spool.segments[at.segment];
        // Only as many as could still go in, not the rest of a 16M segment
        const records = records_read(spool, segment, at.offset, ((wanted === null) ? max_items - items.length : wanted.last - ((last === null) ? spool.reader.seq : last + 1) + 1));
        let stop = false;
        for (const item of records) {
            const fits = ((wanted === null) ? ((items.length < max_items) && ((items.length === 0) || (bytes + item.bytes <= max_bytes))) : item.record.seq <= wanted.last);
            if (fits === false) {
                stop = true;
                break;
            }
            items.push({time: item.record.time, labels: item.record.labels, line: item.record.line});
            first = ((first === null) ? item.record.seq : first);
            last = item.record.seq;
            bytes += item.bytes;
            at.offset = item.end;
        }
        // Full, or the batch being sent is whole again: the reader stays where the batch ends,
        // not at the start of some later segment nothing was taken from
        if (stop || ((wanted !== null) && (last === wanted.last)) || ((wanted === null) && (items.length >= max_items))) {
            break;
        }
        if (segment.closed === false) {
            break;
        }
        at.segment += 1;
        at.offset = 0;
    }
    if (items.length === 0) {
        return null;
    }
    const out = {first, last, count: items.length, bytes, body: JSON.stringify(items), end: at};
    if (wanted === null) {
        spool.inflight = {first, last};
        file_write_synced(path.join(spool.dir, 'inflight.json'), JSON.stringify(spool.inflight));
    }
    return out;
}

// Logline has the batch: the records in it leave, and so does every segment nothing waits in
function ack(spool, cut)
{
    spool.acked = cut.last;
    file_write_synced(path.join(spool.dir, 'acked.json'), JSON.stringify({seq: spool.acked}));
    spool.inflight = null;
    fs.rmSync(path.join(spool.dir, 'inflight.json'), {force: true});
    spool.waiting_bytes = Math.max(0, spool.waiting_bytes - cut.bytes);
    spool.reader = {segment: cut.end.segment, offset: cut.end.offset, seq: cut.last + 1};
    let done = 0;
    while ((done < spool.segments.length) && spool.segments[done].closed && (spool.segments[done].last <= spool.acked)) {
        done += 1;
    }
    if (done > 0) {
        // What they knew about where each container stood is kept before they go
        spool.deleted = {upto: spool.segments[done - 1].last, cursors: spool.segments[done - 1].cursors_at_end};
        file_write_synced(path.join(spool.dir, 'cursors.json'), JSON.stringify(spool.deleted));
        for (const segment of spool.segments.slice(0, done)) {
            fs.rmSync(path.join(spool.dir, segment.name), {force: true});
        }
        spool.segments = spool.segments.slice(done);
        // A batch that ended exactly at the end of a segment leaves the reader there; that
        // segment is gone now, and the next record is at the start of the next one
        spool.reader = ((spool.reader.segment < done) ? {segment: 0, offset: 0, seq: spool.reader.seq} : {segment: spool.reader.segment - done, offset: spool.reader.offset, seq: spool.reader.seq});
    }
    if (spool.waiting_bytes < spool.cap_bytes*ROOM_AT) {
        const waiters = spool.room_waiters;
        spool.room_waiters = [];
        for (const resolve of waiters) {
            resolve();
        }
    }
}

// Full is what waits to be sent, not what is on the disk: acked lines leave with their segment,
// and a spool that counted them would wait for itself
function full(spool)
{
    return spool.waiting_bytes >= spool.cap_bytes;
}

// Resolves when there is room again
function room(spool)
{
    if (full(spool) === false) {
        return Promise.resolve();
    }
    return new Promise(v => spool.room_waiters.push(v));
}

function disk_bytes(spool)
{
    let out = 0;
    for (const segment of spool.segments) {
        out += segment.size;
    }
    for (const text of spool.buffer) {
        out += text.length;
    }
    return out;
}

function stats(spool)
{
    let oldest = null;
    if ((spool.reader !== null) && (spool.reader.segment < spool.segments.length)) {
        const first = records_read(spool, spool.segments[spool.reader.segment], spool.reader.offset, 1)[0];
        // The line's time: a file's lines hold their place as a byte offset, not a moment
        oldest = ((first === undefined) ? null : (first.record.time || first.record.at));
    }
    return {
        waiting_lines: spool.next_seq - 1 - spool.acked,
        waiting_bytes: spool.waiting_bytes,
        oldest_at: oldest,
        disk_bytes: disk_bytes(spool),
        cap_bytes: spool.cap_bytes,
    };
}

function close(spool)
{
    clearInterval(spool.timer);
    flush(spool);
    if (spool.fd !== null) {
        fs.closeSync(spool.fd);
        spool.fd = null;
    }
}

// Records of a segment from a byte offset: [{record, bytes, end}], only what is synced
function records_read(spool, segment, offset, limit)
{
    const out = [];
    const fd = fs.openSync(path.join(spool.dir, segment.name), 'r');
    try {
        let at = offset;
        let rest = Buffer.alloc(0);
        while ((at < segment.size) && ((limit === undefined) || (out.length < limit))) {
            const chunk = Buffer.alloc(Math.min(READ_BYTES, segment.size - at));
            const got = fs.readSync(fd, chunk, 0, chunk.length, at);
            if (got === 0) {
                break;
            }
            at += got;
            const text = Buffer.concat([rest, chunk.subarray(0, got)]);
            let start = 0;
            for (;;) {
                const newline = text.indexOf(10, start);
                if ((newline === -1) || ((limit !== undefined) && (out.length >= limit))) {
                    break;
                }
                const line = text.subarray(start, newline + 1);
                out.push({record: JSON.parse(line.toString('utf8')), bytes: line.length, end: at - text.length + newline + 1});
                start = newline + 1;
            }
            rest = text.subarray(start);
        }
    }
    finally {
        fs.closeSync(fd);
    }
    return out;
}

// The spool as the last process left it. A last line cut short by a crash is cut off: what it
// held was never synced, so it was never collected, and is read from docker again.
function recover(spool)
{
    const kept = json_read(path.join(spool.dir, 'acked.json'), {seq: 0});
    spool.acked = kept.seq;
    spool.inflight = json_read(path.join(spool.dir, 'inflight.json'), null);
    spool.deleted = json_read(path.join(spool.dir, 'cursors.json'), {upto: 0, cursors: {}});
    spool.cursors = JSON.parse(JSON.stringify(spool.deleted.cursors));
    const names = fs.readdirSync(spool.dir).filter(v => RE_SEGMENT.test(v)).sort();
    let next = Math.max(spool.acked, spool.deleted.upto) + 1;
    for (let i = 0; i < names.length; i++) {
        const file = path.join(spool.dir, names[i]);
        let size = fs.statSync(file).size;
        const segment = {name: names[i], first: parseInt(RE_SEGMENT.exec(names[i])[1], 10), last: 0, size, closed: true, cursors_at_end: null};
        segment.last = segment.first - 1;
        const records = records_whole(file, size);
        if (records.size !== size) {
            fs.truncateSync(file, records.size);
            size = records.size;
            segment.size = size;
        }
        for (const item of records.list) {
            if (item.record.seq > spool.deleted.upto) {
                cursor_apply(spool.cursors, item.record);
            }
            if (item.record.seq > spool.acked) {
                spool.waiting_bytes += item.bytes;
                if (spool.reader === null) {
                    spool.reader = {segment: i, offset: item.end - item.bytes, seq: item.record.seq};
                }
            }
            segment.last = item.record.seq;
            next = item.record.seq + 1;
        }
        segment.cursors_at_end = JSON.parse(JSON.stringify(spool.cursors));
        spool.segments.push(segment);
    }
    spool.next_seq = next;
    // The last segment goes on taking records
    const last = spool.segments[spool.segments.length - 1];
    if ((last !== undefined) && (last.size < spool.segment_bytes)) {
        last.closed = false;
        spool.fd = fs.openSync(path.join(spool.dir, last.name), 'a', 0o600);
    }
    if ((spool.inflight !== null) && (spool.inflight.last <= spool.acked)) {
        spool.inflight = null;
    }
}

// Every whole record in a file, and how many bytes they are: a last line without its newline
// is not one
function records_whole(file, size)
{
    const list = [];
    const text = fs.readFileSync(file);
    let start = 0;
    for (;;) {
        const newline = text.indexOf(10, start);
        if ((newline === -1) || (newline >= size)) {
            break;
        }
        let record;
        try {
            record = JSON.parse(text.subarray(start, newline).toString('utf8'));
        }
        catch {
            break;
        }
        list.push({record, bytes: newline + 1 - start, end: newline + 1});
        start = newline + 1;
    }
    return {list, size: start};
}

// Where a container's reading stood: the latest stamp, and how many of its lines share it
function cursor_apply(cursors, record)
{
    const found = cursors[record.src];
    if ((found === undefined) || (record.at > found.at)) {
        cursors[record.src] = {at: record.at, n: 1};
    }
    else if (record.at === found.at) {
        found.n += 1;
    }
}

function nothing()
{
}

function json_read(file, fallback)
{
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return fallback;
        }
        throw error;
    }
}

function dir_sync(dir)
{
    const fd = fs.openSync(dir, 'r');
    try {
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
}

module.exports = logline_spool;
