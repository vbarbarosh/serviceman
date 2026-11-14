// A folder of this computer as a zip, for an app dropped on the page as a folder: every file
// stored as it is, with its path from the folder and its checksum, which is what serviceman's
// reader asks of a zip. Stored, not packed: the files of a page are few, and most of them are
// packed already.
//
//     files  [{path, file}], file a File or a Blob
//
//     a Blob, application/zip
async function zip_blob(files)
{
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const item of files) {
        const name = encoder.encode(item.path);
        const bytes = new Uint8Array(await item.file.arrayBuffer());
        const crc = crc32(bytes);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        // Bit 11: the name is UTF-8
        local.setUint16(6, 0x0800, true);
        local.setUint16(8, 0, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, bytes.length, true);
        local.setUint32(22, bytes.length, true);
        local.setUint16(26, name.length, true);
        parts.push(local, name, bytes);
        const entry = new DataView(new ArrayBuffer(46));
        entry.setUint32(0, 0x02014b50, true);
        entry.setUint16(4, 20, true);
        entry.setUint16(6, 20, true);
        entry.setUint16(8, 0x0800, true);
        entry.setUint16(10, 0, true);
        entry.setUint32(16, crc, true);
        entry.setUint32(20, bytes.length, true);
        entry.setUint32(24, bytes.length, true);
        entry.setUint16(28, name.length, true);
        entry.setUint32(42, offset, true);
        central.push(entry, name);
        offset += 30 + name.length + bytes.length;
    }
    const size = central.reduce((sum, v) => sum + v.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], {type: 'application/zip'});
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

const CRC_TABLE = (function () {
    const out = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        out[n] = c >>> 0;
    }
    return out;
})();

export default zip_blob;
