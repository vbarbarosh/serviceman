const fs = require('fs');
const stream = require('stream');
const zlib = require('zlib');

// The files of a zip, read as the page reads one it is given (src/main/public/zip_entries.js,
// with the browser's Blob): each one's name, mode and time, and its bytes as a stream when
// asked for. The zip is a file on disk or a Buffer, and only its list is held in memory: a zip
// of any size is read a file at a time. Stored and deflated entries are read, zip64 too, for a
// zip above 4 GiB or of more than 65535 files; encrypted ones are refused with a sentence that
// says so, and so is one whose files would unpack past the limit, since a small zip can say it
// holds terabytes.
//
//     source   the path of the zip, or its bytes as a Buffer
//
//     [{name, dir, link, mode, mtime_s, size, stream()}]
//     link      a symbolic link, which a zip made on unix may hold
//     mode      the unix mode a zip made on unix keeps, 0 when it keeps none
//     stream()  its bytes, a Readable that fails when they are not as long as the list says

const END_SIGNATURE = 0x06054b50;
const END64_SIGNATURE = 0x06064b50;
const END64_LOCATOR_SIGNATURE = 0x07064b50;
const ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EXTRA_ZIP64 = 0x0001;
// The end record is 22 bytes, after it a comment of up to 64 KiB
const END_SEARCH_BYTES = 22 + 65535;
const MADE_ON_UNIX = 3;
const UNIX_TYPE = 0o170000;
const UNIX_LINK = 0o120000;
const FLAG_ENCRYPTED = 1;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
// What all its files may come to once unpacked: an app folder, not a disk image
const UNPACKED_LIMIT_BYTES = 64*1024*1024*1024;

function zip_entries(source)
{
    const zip = zip_open(source);
    try {
        return entries_read(zip);
    }
    finally {
        zip.close();
    }
}

function entries_read(zip)
{
    const tail_start = Math.max(0, zip.size - END_SEARCH_BYTES);
    const tail = zip.read(tail_start, zip.size - tail_start);
    const end = end_find(tail);
    if (end === -1) {
        throw new Error('it is not a zip: it has no list of its files at its end');
    }
    const list_at = list_where(zip, tail, tail_start, end);
    if (list_at.offset + list_at.size > zip.size) {
        throw new Error('it is a broken zip: its list of files is cut short');
    }
    const list = zip.read(list_at.offset, list_at.size);
    const out = [];
    let unpacked = 0;
    let at = 0;
    for (let i = 0; i < list_at.count; i++) {
        if ((at + 46 > list.length) || (list.readUInt32LE(at) !== ENTRY_SIGNATURE)) {
            throw new Error('it is a broken zip: its list of files is cut short');
        }
        const made_on = list.readUInt16LE(at + 4) >> 8;
        const flags = list.readUInt16LE(at + 8);
        const method = list.readUInt16LE(at + 10);
        const time = list.readUInt16LE(at + 12);
        const date = list.readUInt16LE(at + 14);
        const name_bytes = list.readUInt16LE(at + 28);
        const extra_bytes = list.readUInt16LE(at + 30);
        const comment_bytes = list.readUInt16LE(at + 32);
        const attributes = list.readUInt32LE(at + 38);
        if (at + 46 + name_bytes + extra_bytes > list.length) {
            throw new Error('it is a broken zip: its list of files is cut short');
        }
        const name = list.toString('utf8', at + 46, at + 46 + name_bytes);
        const sizes = sizes_read(list, at, list.subarray(at + 46 + name_bytes, at + 46 + name_bytes + extra_bytes));
        at += 46 + name_bytes + extra_bytes + comment_bytes;
        unpacked += sizes.length;
        if (unpacked > UNPACKED_LIMIT_BYTES) {
            throw new Error(`its files come to more than ${UNPACKED_LIMIT_BYTES} bytes unpacked, which is not read here`);
        }
        const unix = (made_on === MADE_ON_UNIX) ? (attributes >>> 16) : 0;
        const entry = {name, flags, method, packed: sizes.packed, length: sizes.length, local: sizes.local};
        out.push({
            name,
            dir: name.endsWith('/'),
            link: (unix & UNIX_TYPE) === UNIX_LINK,
            mode: unix & 0o7777,
            mtime_s: dos_seconds(date, time),
            size: sizes.length,
            stream: () => entry_stream(zip.source, entry),
        });
    }
    return out;
}

// Where the end record begins in the zip's last bytes, looked for back from the end, past a
// comment; -1 when there is none
function end_find(tail)
{
    for (let at = tail.length - 22; at >= 0; at--) {
        if (tail.readUInt32LE(at) === END_SIGNATURE) {
            return at;
        }
    }
    return -1;
}

// How many files the list holds, where it starts and how long it is. A zip64 keeps them in a
// record of its own, the end record saying only that it is one.
function list_where(zip, tail, tail_start, end)
{
    const count = tail.readUInt16LE(end + 10);
    const size = tail.readUInt32LE(end + 12);
    const offset = tail.readUInt32LE(end + 16);
    if ((count !== 0xffff) && (size !== 0xffffffff) && (offset !== 0xffffffff)) {
        return {count, size, offset};
    }
    // The locator is the 20 bytes just before the end record, and says where the zip64 one is
    const locator = tail_start + end - 20;
    const found = (locator >= 0) ? zip.read(locator, 20) : Buffer.alloc(0);
    if ((found.length < 20) || (found.readUInt32LE(0) !== END64_LOCATOR_SIGNATURE)) {
        if ((count === 0xffff) && (size !== 0xffffffff) && (offset !== 0xffffffff)) {
            // Exactly 65535 files in a plain zip
            return {count, size, offset};
        }
        throw new Error('it is a broken zip64: it has no record of where its list is');
    }
    const record_at = Number(found.readBigUInt64LE(8));
    const record = zip.read(record_at, 56);
    if ((record.length < 56) || (record.readUInt32LE(0) !== END64_SIGNATURE)) {
        throw new Error('it is a broken zip64: its list is not where it says');
    }
    return {count: Number(record.readBigUInt64LE(32)), size: Number(record.readBigUInt64LE(40)), offset: Number(record.readBigUInt64LE(48))};
}

// A file's sizes and where it begins; one above 4 GiB, or further than that into the zip, keeps
// them in its zip64 extra field, in this order, each only when the list's own says 0xffffffff
function sizes_read(list, at, extra)
{
    const out = {packed: list.readUInt32LE(at + 20), length: list.readUInt32LE(at + 24), local: list.readUInt32LE(at + 42)};
    const wide = ['length', 'packed', 'local'].filter(v => out[v] === 0xffffffff);
    if (wide.length === 0) {
        return out;
    }
    for (let i = 0; i + 4 <= extra.length; i += 4 + extra.readUInt16LE(i + 2)) {
        if (extra.readUInt16LE(i) !== EXTRA_ZIP64) {
            continue;
        }
        const end = i + 4 + extra.readUInt16LE(i + 2);
        let field = i + 4;
        for (const key of wide) {
            if (field + 8 > end) {
                break;
            }
            out[key] = Number(extra.readBigUInt64LE(field));
            field += 8;
        }
        break;
    }
    return out;
}

// The zip as what reads it: a file is opened once for its list and read where asked, a Buffer
// is cut
function zip_open(source)
{
    if (Buffer.isBuffer(source)) {
        return {
            source,
            size: source.length,
            read: (start, length) => source.subarray(start, start + length),
            close: function () {},
        };
    }
    const fd = fs.openSync(source, 'r');
    return {
        source,
        size: fs.fstatSync(fd).size,
        read: function (start, length) {
            const bytes = Buffer.alloc(length);
            let done = 0;
            while (done < length) {
                const read = fs.readSync(fd, bytes, done, length - done, start + done);
                if (read === 0) {
                    break;
                }
                done += read;
            }
            return bytes.subarray(0, done);
        },
        close: function () {
            fs.closeSync(fd);
        },
    };
}

// One file's bytes as they unpack, checked against the length the list says: more than that is
// a zip made to fill the disk, less is a broken one
function entry_stream(source, entry)
{
    return stream.Readable.from(entry_chunks(source, entry), {objectMode: false});
}

async function* entry_chunks(source, entry)
{
    if ((entry.flags & FLAG_ENCRYPTED) !== 0) {
        throw new Error(`${entry.name} is encrypted in the zip, which is not read here`);
    }
    if ((entry.method !== METHOD_STORED) && (entry.method !== METHOD_DEFLATED)) {
        throw new Error(`${entry.name} is packed with a method not read here: only stored and deflated files are`);
    }
    const zip = zip_open(source);
    let start;
    try {
        const head = zip.read(entry.local, 30);
        if ((head.length < 30) || (head.readUInt32LE(0) !== LOCAL_SIGNATURE)) {
            throw new Error(`${entry.name} is not where the zip says it is`);
        }
        start = entry.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
        if (start + entry.packed > zip.size) {
            throw new Error(`${entry.name} runs past the end of the zip`);
        }
    }
    finally {
        zip.close();
    }
    const packed = packed_stream(source, start, entry.packed);
    const unpacked = (entry.method === METHOD_STORED) ? packed : stream.pipeline(packed, zlib.createInflateRaw(), function () {});
    let length = 0;
    try {
        for await (const chunk of unpacked) {
            length += chunk.length;
            if (length > entry.length) {
                throw new Error('it unpacks to more than its list says');
            }
            yield chunk;
        }
    }
    catch (error) {
        unpacked.destroy();
        throw new Error(`${entry.name} does not unpack as the zip says: ${error.message}`);
    }
    if (length !== entry.length) {
        throw new Error(`${entry.name} does not unpack as the zip says: it is ${length} bytes, its list says ${entry.length}`);
    }
}

function packed_stream(source, start, length)
{
    if (Buffer.isBuffer(source)) {
        return stream.Readable.from([source.subarray(start, start + length)]);
    }
    if (length === 0) {
        return stream.Readable.from([]);
    }
    return fs.createReadStream(source, {start, end: start + length - 1});
}

// A zip keeps its times as DOS does, in local time, to two seconds
function dos_seconds(date, time)
{
    const year = (date >> 9) + 1980;
    const at = new Date(year, ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31)*2);
    return Math.floor(at.getTime()/1000);
}

module.exports = zip_entries;
