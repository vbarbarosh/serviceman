const zlib = require('zlib');

// A zip as a working copy is zipped on unix, for the tests: each file deflated, with its mode
// and its kind in the unix bits, a folder as an entry of its own. What a test wants wrong is
// said per file: `size` for a length the list states instead of the real one, `link` for a
// symbolic link, `mode` 0 for a file zipped with no mode kept. A zip64 keeps every size and
// place in its zip64 fields, as a zip above 4 GiB or of more than 65535 files does.
//
//     [{name, bytes, mode, link, size}]   bytes null for a folder
//     options.zip64                       true for a zip64
function zip_bytes(files, options)
{
    const zip64 = (options !== undefined) && (options.zip64 === true);
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
        let extra = Buffer.alloc(0);
        if (zip64) {
            extra = Buffer.alloc(28);
            extra.writeUInt16LE(0x0001, 0);
            extra.writeUInt16LE(24, 2);
            extra.writeBigUInt64LE(BigInt(length), 4);
            extra.writeBigUInt64LE(BigInt(packed.length), 12);
            extra.writeBigUInt64LE(BigInt(offset), 20);
            central.writeUInt32LE(0xffffffff, 20);
            central.writeUInt32LE(0xffffffff, 24);
            central.writeUInt32LE(0xffffffff, 42);
            central.writeUInt16LE(extra.length, 30);
        }
        locals.push(local, name, packed);
        centrals.push(central, name, extra);
        offset += 30 + name.length + packed.length;
    }
    const list = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(list.length, 12);
    end.writeUInt32LE(offset, 16);
    if (zip64 === false) {
        return Buffer.concat(locals.concat([list, end]));
    }
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(files.length), 24);
    record.writeBigUInt64LE(BigInt(files.length), 32);
    record.writeBigUInt64LE(BigInt(list.length), 40);
    record.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + list.length), 8);
    locator.writeUInt32LE(1, 16);
    end.writeUInt16LE(0xffff, 8);
    end.writeUInt16LE(0xffff, 10);
    end.writeUInt32LE(0xffffffff, 12);
    end.writeUInt32LE(0xffffffff, 16);
    return Buffer.concat(locals.concat([list, record, locator, end]));
}

module.exports = zip_bytes;
