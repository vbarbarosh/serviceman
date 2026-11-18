const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// What one app sent this way may come to: it is held in memory on its way. More files than
// 65535 would need a zip64, which is not written here.
const BYTES_LIMIT = 256*1024*1024;
const FILES_LIMIT = 65535;
const LOCAL_SIGNATURE = 0x04034b50;
const ENTRY_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const VERSION_NEEDED = 20;
// Bit 11: the names are UTF-8
const FLAG_UTF8 = 0x0800;
const METHOD_DEFLATED = 8;
const CRC_TABLE = crc_table_make();
// Never sent, at any depth, whoever asks: a repository's history and a file of secrets, which an
// app of files would serve to whoever opens its link
const RE_NEVER_SENT = /^(\.git|\.env(\..+)?)$/;

// A folder as a zip, for serviceman to take as an app of files: every file in it at every
// depth, hidden ones too, each deflated, named by its path from the folder, but a .git and a .env
// (or .env.local), which are left out and said by their paths. A link is refused,
// never followed, so no file from outside the folder goes by surprise; so is what is neither a
// file nor a folder. Each file keeps no time and no mode: serviceman writes them fresh, to be
// read (app_files_put). The checksum and the sizes are in the list, where serviceman's reader
// takes them (src/main/src/helpers/zip_entries.js).
//
//     dir  the folder, an absolute path
//
//     {zip, left}: a Buffer, the zip; the paths left out, a folder ending in /
async function zip_from_folder(dir)
{
    const found = await stat_or_null(dir);
    if (found === null) {
        throw new Error(`${dir}: there is no such folder`);
    }
    if (found.isDirectory() === false) {
        throw new Error(`${dir} is a file, not a folder: send the folder that holds its index.html`);
    }
    const walked = {dir, files: [], bytes: 0, left: []};
    await folder_walk(walked, '');
    const parts = [];
    const list = [];
    let offset = 0;
    for (const file of walked.files) {
        const name = Buffer.from(file);
        const bytes = await fs.promises.readFile(path.join(dir, file));
        const packed = zlib.deflateRawSync(bytes);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(LOCAL_SIGNATURE, 0);
        local.writeUInt16LE(VERSION_NEEDED, 4);
        local.writeUInt16LE(FLAG_UTF8, 6);
        local.writeUInt16LE(METHOD_DEFLATED, 8);
        local.writeUInt32LE(crc32(bytes), 14);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(bytes.length, 22);
        local.writeUInt16LE(name.length, 26);
        // The list's entry says the same from its byte 6 on, and where the file starts
        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(ENTRY_SIGNATURE, 0);
        entry.writeUInt16LE(VERSION_NEEDED, 4);
        local.copy(entry, 6, 4, 30);
        entry.writeUInt32LE(offset, 42);
        parts.push(local, name, packed);
        list.push(entry, name);
        offset += local.length + name.length + packed.length;
    }
    const list_bytes = list.reduce((sum, v) => sum + v.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_SIGNATURE, 0);
    end.writeUInt16LE(walked.files.length, 8);
    end.writeUInt16LE(walked.files.length, 10);
    end.writeUInt32LE(list_bytes, 12);
    end.writeUInt32LE(offset, 16);
    return {zip: Buffer.concat([...parts, ...list, end]), left: walked.left};
}

// Every file under one folder of the walk, its path from the top with / between names, added to
// walked.files in name order; the walk stops as soon as the files are more than may go
async function folder_walk(walked, under)
{
    const entries = await fs.promises.readdir(path.join(walked.dir, under), {withFileTypes: true});
    entries.sort((a, b) => (a.name < b.name) ? -1 : 1);
    for (const entry of entries) {
        const relative = (under === '') ? entry.name : `${under}/${entry.name}`;
        if (RE_NEVER_SENT.test(entry.name)) {
            walked.left.push(entry.isDirectory() ? `${relative}/` : relative);
            continue;
        }
        if (entry.isDirectory()) {
            await folder_walk(walked, relative);
            continue;
        }
        if (entry.isSymbolicLink()) {
            throw new Error(`${relative} is a link, and links are not sent: put the file it points at in its place`);
        }
        if (entry.isFile() === false) {
            throw new Error(`${relative} is neither a file nor a folder, which an app of files cannot hold`);
        }
        const stat = await fs.promises.stat(path.join(walked.dir, relative));
        walked.files.push(relative);
        walked.bytes += stat.size;
        if ((walked.files.length > FILES_LIMIT) || (walked.bytes > BYTES_LIMIT)) {
            throw new Error(`${walked.dir} holds more than an app sent this way may (${FILES_LIMIT} files, ${BYTES_LIMIT} bytes): send the folder that is the app, its built one, not the project around it`);
        }
    }
}

async function stat_or_null(target)
{
    try {
        return await fs.promises.stat(target);
    }
    catch {
        return null;
    }
}

// The zip's checksum of a file's bytes
function crc32(bytes)
{
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function crc_table_make()
{
    const out = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        out[n] = c >>> 0;
    }
    return out;
}

module.exports = zip_from_folder;
