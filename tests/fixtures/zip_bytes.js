const zlib = require('zlib');

// A zip as a working copy is zipped on unix, for the tests: each file deflated, with its mode
// and its kind in the unix bits, a folder as an entry of its own. What a test wants wrong is
// said per file: `size` for a length the list states instead of the real one, `link` for a
// symbolic link, `mode` 0 for a file zipped with no mode kept.
//
//     [{name, bytes, mode, link, size}]   bytes null for a folder
function zip_bytes(files)
{
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const file of files) {
        const name = Buffer.from(file.name);
        const bytes = ((file.bytes === null) || (file.bytes === undefined)) ? null : file.bytes;
        const packed = (bytes === null) ? Buffer.alloc(0) : zlib.deflateRawSync(bytes);
        const length = (file.size === undefined) ? ((bytes === null) ? 0 : bytes.length) : file.size;
        const mode = (file.mode === undefined) ? ((bytes === null) ? 0o755 : 0o644) : file.mode;
        const kind = file.link ? 0o120000 : ((bytes === null) ? 0o040000 : 0o100000);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(8, 8);
        local.writeUInt16LE(0x21, 12);
        local.writeUInt32LE((bytes === null) ? 0 : zlib.crc32(bytes), 14);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(length, 22);
        local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(0x0314, 4);
        local.copy(central, 6, 4, 30);
        central.writeUInt32LE(((kind | mode) << 16) >>> 0, 38);
        central.writeUInt32LE(offset, 42);
        locals.push(local, name, packed);
        centrals.push(central, name);
        offset += 30 + name.length + packed.length;
    }
    const list = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(list.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat(locals.concat([list, end]));
}

module.exports = zip_bytes;
