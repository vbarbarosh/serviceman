const zlib = require('zlib');

// The files of a zip held whole in memory, read as the page reads one it is given
// (src/main/public/zip_entries.js, with the browser's Blob): each one's name, mode and time,
// and its bytes when asked for. Stored and deflated entries are read; zip64 and encrypted ones
// are refused with a sentence that says so, and so is one whose files would unpack past the
// limit, since a small zip can say it holds gigabytes.
//
//     [{name, dir, link, mode, mtime_s, size, bytes()}]
//     link     a symbolic link, which a zip made on unix may hold
//     mode     the unix mode a zip made on unix keeps, 0 when it keeps none
//     bytes()  its bytes, a Buffer

const END_SIGNATURE = 0x06054b50;
const ENTRY_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
// The end record is 22 bytes, after it a comment of up to 64 KiB
const END_SEARCH_BYTES = 22 + 65535;
const MADE_ON_UNIX = 3;
const UNIX_TYPE = 0o170000;
const UNIX_LINK = 0o120000;
const FLAG_ENCRYPTED = 1;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
// What all its files may come to once unpacked: an app folder, not a disk image
const UNPACKED_LIMIT_BYTES = 1024*1024*1024;

function zip_entries(buffer)
{
    const end = end_find(buffer);
    if (end === -1) {
        throw new Error('it is not a zip: it has no list of its files at its end');
    }
    const count = buffer.readUInt16LE(end + 10);
    const size = buffer.readUInt32LE(end + 12);
    const offset = buffer.readUInt32LE(end + 16);
    if ((count === 0xffff) || (offset === 0xffffffff)) {
        throw new Error('it is a zip64, which is not read here: zip it again as a plain zip');
    }
    const list_end = Math.min(buffer.length, offset + size);
    const out = [];
    let unpacked = 0;
    let at = offset;
    for (let i = 0; i < count; i++) {
        if ((at + 46 > list_end) || (buffer.readUInt32LE(at) !== ENTRY_SIGNATURE)) {
            throw new Error('it is a broken zip: its list of files is cut short');
        }
        const made_on = buffer.readUInt16LE(at + 4) >> 8;
        const flags = buffer.readUInt16LE(at + 8);
        const method = buffer.readUInt16LE(at + 10);
        const time = buffer.readUInt16LE(at + 12);
        const date = buffer.readUInt16LE(at + 14);
        const packed = buffer.readUInt32LE(at + 20);
        const length = buffer.readUInt32LE(at + 24);
        const name_bytes = buffer.readUInt16LE(at + 28);
        const extra_bytes = buffer.readUInt16LE(at + 30);
        const comment_bytes = buffer.readUInt16LE(at + 32);
        const attributes = buffer.readUInt32LE(at + 38);
        const local = buffer.readUInt32LE(at + 42);
        if (at + 46 + name_bytes > list_end) {
            throw new Error('it is a broken zip: its list of files is cut short');
        }
        const name = buffer.toString('utf8', at + 46, at + 46 + name_bytes);
        at += 46 + name_bytes + extra_bytes + comment_bytes;
        unpacked += length;
        if (unpacked > UNPACKED_LIMIT_BYTES) {
            throw new Error(`its files come to more than ${UNPACKED_LIMIT_BYTES} bytes unpacked, which is not read here`);
        }
        const unix = (made_on === MADE_ON_UNIX) ? (attributes >>> 16) : 0;
        out.push({
            name,
            dir: name.endsWith('/'),
            link: (unix & UNIX_TYPE) === UNIX_LINK,
            mode: unix & 0o7777,
            mtime_s: dos_seconds(date, time),
            size: length,
            bytes: () => entry_bytes(buffer, {name, flags, method, packed, length, local}),
        });
    }
    return out;
}

// Where the end record begins, looked for back from the end, past a comment; -1 when there is none
function end_find(buffer)
{
    const from = Math.max(0, buffer.length - END_SEARCH_BYTES);
    for (let at = buffer.length - 22; at >= from; at--) {
        if (buffer.readUInt32LE(at) === END_SIGNATURE) {
            return at;
        }
    }
    return -1;
}

function entry_bytes(buffer, entry)
{
    if ((entry.flags & FLAG_ENCRYPTED) !== 0) {
        throw new Error(`${entry.name} is encrypted in the zip, which is not read here`);
    }
    if ((entry.local + 30 > buffer.length) || (buffer.readUInt32LE(entry.local) !== LOCAL_SIGNATURE)) {
        throw new Error(`${entry.name} is not where the zip says it is`);
    }
    const start = entry.local + 30 + buffer.readUInt16LE(entry.local + 26) + buffer.readUInt16LE(entry.local + 28);
    if (start + entry.packed > buffer.length) {
        throw new Error(`${entry.name} runs past the end of the zip`);
    }
    const packed = buffer.subarray(start, start + entry.packed);
    if (entry.method === METHOD_STORED) {
        return packed;
    }
    if (entry.method !== METHOD_DEFLATED) {
        throw new Error(`${entry.name} is packed with a method not read here: only stored and deflated files are`);
    }
    // The list said how long it is: more than that is a zip made to fill the memory
    try {
        return zlib.inflateRawSync(packed, {maxOutputLength: Math.max(1, entry.length)});
    }
    catch (error) {
        throw new Error(`${entry.name} does not unpack as the zip says: ${error.message}`);
    }
}

// A zip keeps its times as DOS does, in local time, to two seconds
function dos_seconds(date, time)
{
    const year = (date >> 9) + 1980;
    const at = new Date(year, ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31)*2);
    return Math.floor(at.getTime()/1000);
}

module.exports = zip_entries;
