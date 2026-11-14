// The files of a zip, read in the page: each one's name, mode and time, and its bytes when asked
// for. A zip dropped on the page goes to a machine as its files, so nothing on that machine has
// to unpack it. Stored and deflated entries are read, zip64 too, for a zip above 4 GiB or of
// more than 65535 files; encrypted ones are refused with a sentence that says so, and a file that
// is no zip at all with one that says what it is, by its first bytes (not_zip_said).
//
//     [{name, dir, link, mode, mtime_s, size, bytes()}]
//     link     a symbolic link, which a zip made on unix may hold
//     mode     the unix mode a zip made on unix keeps, 0 when it keeps none
//     bytes()  a promise of its bytes, as a Uint8Array

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
// What a file given for a zip is instead, by the bytes it starts with
const ZIP_LOCAL_START = [0x50, 0x4b, 0x03, 0x04];
const KINDS = [
    {start: [0x89, 0x50, 0x4e, 0x47], said: 'a PNG picture'},
    {start: [0xff, 0xd8, 0xff], said: 'a JPEG picture'},
    {start: [0x47, 0x49, 0x46, 0x38], said: 'a GIF picture'},
    {start: [0x25, 0x50, 0x44, 0x46], said: 'a PDF'},
    {start: [0x1f, 0x8b], said: 'a gzip file (.gz, .tar.gz)'},
    {start: [0x42, 0x5a, 0x68], said: 'a bzip2 file'},
    {start: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], said: 'an xz file'},
    {start: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], said: 'a 7z archive'},
    {start: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], said: 'a RAR archive'},
];
// A tar says so 257 bytes in
const TAR_MAGIC_AT = 257;
const TAR_MAGIC = 'ustar';
const HEAD_BYTES = 512;
// A page starts with its doctype, a comment or one of the tags a page or a piece of one starts with
const RE_HTML_START = /^\s*<(!doctype\s+html|!--|(html|head|body|meta|title|link|base|script|style|main|div|section|p|h[1-6])[\s/>])/i;

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
        throw new Error(not_zip_said(new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer())));
    }
    const tail_start = Math.max(0, blob.size - END_SEARCH_BYTES);
    const {count, size, offset} = await list_where(blob, tail, tail_start, end);
    if (offset + size > blob.size) {
        throw new Error('it is a broken zip: its list of files is cut short');
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
        const name_bytes = list.getUint16(at + 28, true);
        const extra_bytes = list.getUint16(at + 30, true);
        const comment_bytes = list.getUint16(at + 32, true);
        const attributes = list.getUint32(at + 38, true);
        if (at + 46 + name_bytes + extra_bytes > list.byteLength) {
            throw new Error('it is a broken zip: its list of files is cut short');
        }
        const name = names.decode(new Uint8Array(list.buffer, list.byteOffset + at + 46, name_bytes));
        const {packed, length, local} = sizes_read(list, at, at + 46 + name_bytes, extra_bytes);
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

// How many files the list holds, where it starts and how long it is. A zip64 keeps them in a
// record of its own, the end record saying only that it is one.
async function list_where(blob, tail, tail_start, end)
{
    const count = tail.getUint16(end + 10, true);
    const size = tail.getUint32(end + 12, true);
    const offset = tail.getUint32(end + 16, true);
    if ((count !== 0xffff) && (size !== 0xffffffff) && (offset !== 0xffffffff)) {
        return {count, size, offset};
    }
    // The locator is the 20 bytes just before the end record, and says where the zip64 one is
    const locator = tail_start + end - 20;
    const found = new DataView(await blob.slice(Math.max(0, locator), Math.max(0, locator + 20)).arrayBuffer());
    if ((locator < 0) || (found.byteLength < 20) || (found.getUint32(0, true) !== END64_LOCATOR_SIGNATURE)) {
        if ((count === 0xffff) && (size !== 0xffffffff) && (offset !== 0xffffffff)) {
            // Exactly 65535 files in a plain zip
            return {count, size, offset};
        }
        throw new Error('it is a broken zip64: it has no record of where its list is');
    }
    const record_at = Number(found.getBigUint64(8, true));
    const record = new DataView(await blob.slice(record_at, record_at + 56).arrayBuffer());
    if ((record.byteLength < 56) || (record.getUint32(0, true) !== END64_SIGNATURE)) {
        throw new Error('it is a broken zip64: its list is not where it says');
    }
    return {count: Number(record.getBigUint64(32, true)), size: Number(record.getBigUint64(40, true)), offset: Number(record.getBigUint64(48, true))};
}

// A file's sizes and where it begins; one above 4 GiB, or further than that into the zip, keeps
// them in its zip64 extra field, in this order, each only when the list's own says 0xffffffff
function sizes_read(list, at, extra_at, extra_bytes)
{
    const out = {packed: list.getUint32(at + 20, true), length: list.getUint32(at + 24, true), local: list.getUint32(at + 42, true)};
    const wide = ['length', 'packed', 'local'].filter(v => out[v] === 0xffffffff);
    if (wide.length === 0) {
        return out;
    }
    const extra_end = extra_at + extra_bytes;
    for (let i = extra_at; i + 4 <= extra_end; i += 4 + list.getUint16(i + 2, true)) {
        if (list.getUint16(i, true) !== EXTRA_ZIP64) {
            continue;
        }
        const end = Math.min(extra_end, i + 4 + list.getUint16(i + 2, true));
        let field = i + 4;
        for (const key of wide) {
            if (field + 8 > end) {
                break;
            }
            out[key] = Number(list.getBigUint64(field, true));
            field += 8;
        }
        break;
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

// What a file with no list of a zip's files at its end is, by its first bytes: nothing at all,
// a zip that was cut short (a download that stopped), a file of another kind, or none known
//
//     head  its first bytes, up to HEAD_BYTES of them, a Uint8Array
function not_zip_said(head)
{
    if (head.length === 0) {
        return 'it is empty, not a zip';
    }
    if (starts_with(head, ZIP_LOCAL_START)) {
        return 'it is a zip cut short: the list of its files, kept at its end, is missing';
    }
    const kind = KINDS.find(v => starts_with(head, v.start));
    if (kind !== undefined) {
        return `it is ${kind.said}, not a zip`;
    }
    const text = new TextDecoder().decode(head).replace(/^\uFEFF/, '');
    if (text.slice(TAR_MAGIC_AT, TAR_MAGIC_AT + TAR_MAGIC.length) === TAR_MAGIC) {
        return 'it is a tar archive, not a zip';
    }
    if (RE_HTML_START.test(text)) {
        return 'it is an HTML page, not a zip';
    }
    return 'it is not a zip: it has no list of its files at its end';
}

function starts_with(head, bytes)
{
    return (head.length >= bytes.length) && bytes.every((v, i) => head[i] === v);
}

// A zip keeps its times as DOS does, in local time, to two seconds
function dos_seconds(date, time)
{
    const year = (date >> 9) + 1980;
    const at = new Date(year, ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31)*2);
    return Math.floor(at.getTime()/1000);
}

export default zip_entries;
