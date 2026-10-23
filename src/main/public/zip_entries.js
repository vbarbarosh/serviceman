// The files of a zip, read in the page: each one's name, mode and time, and its bytes when asked
// for. A zip dropped on the page goes to a machine as its files, so nothing on that machine has
// to unpack it. Stored and deflated entries are read; zip64 and encrypted ones are refused with
// a sentence that says so.
//
//     [{name, dir, link, mode, mtime_s, size, bytes()}]
//     link     a symbolic link, which a zip made on unix may hold
//     mode     the unix mode a zip made on unix keeps, 0 when it keeps none
//     bytes()  a promise of its bytes, as a Uint8Array

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

async function zip_entries(blob)
{
    const tail = new DataView(await blob.slice(Math.max(0, blob.size - END_SEARCH_BYTES)).arrayBuffer());
    let end = -1;
    for (let at = tail.byteLength - 22; at >= 0; at--) {
        if (tail.getUint32(at, true) === END_SIGNATURE) {
            end = at;
            break;
        }
    }
    if (end === -1) {
        throw new Error('it is not a zip: it has no list of its files at its end');
    }
    const count = tail.getUint16(end + 10, true);
    const size = tail.getUint32(end + 12, true);
    const offset = tail.getUint32(end + 16, true);
    if ((count === 0xffff) || (offset === 0xffffffff)) {
        throw new Error('it is a zip64, which is not read here: zip it again as a plain zip');
    }
    const list = new DataView(await blob.slice(offset, offset + size).arrayBuffer());
    const names = new TextDecoder();
    const out = [];
    let at = 0;
    for (let i = 0; i < count; i++) {
        if ((at + 46 > list.byteLength) || (list.getUint32(at, true) !== ENTRY_SIGNATURE)) {
            throw new Error('it is a broken zip: its list of files is cut short');
        }
        const made_on = list.getUint16(at + 4, true) >> 8;
        const flags = list.getUint16(at + 8, true);
        const method = list.getUint16(at + 10, true);
        const time = list.getUint16(at + 12, true);
        const date = list.getUint16(at + 14, true);
        const packed = list.getUint32(at + 20, true);
        const length = list.getUint32(at + 24, true);
        const name_bytes = list.getUint16(at + 28, true);
        const extra_bytes = list.getUint16(at + 30, true);
        const comment_bytes = list.getUint16(at + 32, true);
        const attributes = list.getUint32(at + 38, true);
        const local = list.getUint32(at + 42, true);
        const name = names.decode(new Uint8Array(list.buffer, list.byteOffset + at + 46, name_bytes));
        at += 46 + name_bytes + extra_bytes + comment_bytes;
        const unix = (made_on === MADE_ON_UNIX) ? (attributes >>> 16) : 0;
        out.push({
            name,
            dir: name.endsWith('/'),
            link: (unix & UNIX_TYPE) === UNIX_LINK,
            mode: unix & 0o7777,
            mtime_s: dos_seconds(date, time),
            size: length,
            bytes: () => entry_bytes(blob, {name, flags, method, packed, local}),
        });
    }
    return out;
}

async function entry_bytes(blob, entry)
{
    if ((entry.flags & FLAG_ENCRYPTED) !== 0) {
        throw new Error(`${entry.name} is encrypted in the zip, which is not read here`);
    }
    const head = new DataView(await blob.slice(entry.local, entry.local + 30).arrayBuffer());
    if ((head.byteLength < 30) || (head.getUint32(0, true) !== LOCAL_SIGNATURE)) {
        throw new Error(`${entry.name} is not where the zip says it is`);
    }
    const start = entry.local + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    const packed = blob.slice(start, start + entry.packed);
    if (entry.method === METHOD_STORED) {
        return new Uint8Array(await packed.arrayBuffer());
    }
    if (entry.method !== METHOD_DEFLATED) {
        throw new Error(`${entry.name} is packed with a method not read here: only stored and deflated files are`);
    }
    const unpacked = packed.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(unpacked).arrayBuffer());
}

// A zip keeps its times as DOS does, in local time, to two seconds
function dos_seconds(date, time)
{
    const year = (date >> 9) + 1980;
    const at = new Date(year, ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31)*2);
    return Math.floor(at.getTime()/1000);
}

export default zip_entries;
