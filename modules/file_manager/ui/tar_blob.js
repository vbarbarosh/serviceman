// Files as one tar, to go up as one stream: [{file, name}] -> {blob, ends}. `name` is the way
// under the folder the tar is unpacked in, photos/2024/a.jpg. The blob holds the files
// themselves, not copies of them, so a tar of gigabytes costs the page its headers only.
// `ends` says where each file's bytes end in it, for the page to tell which files are past.
function tar_blob(entries)
{
    const parts = [];
    const ends = [];
    let at = 0;
    for (const {file, name} of entries) {
        const bytes = new TextEncoder().encode(name);
        // A name of more than 100 bytes goes before its file, as GNU tar writes it
        if (bytes.length > 100) {
            const long = new Uint8Array(block_size(bytes.length + 1));
            long.set(bytes);
            parts.push(header_of('././@LongLink', bytes.length + 1, 0, 'L'), long);
            at += 512 + long.length;
        }
        parts.push(header_of(name, file.size, Math.floor(file.lastModified/1000), '0'), file);
        at += 512 + file.size;
        ends.push(at);
        const pad = block_size(file.size) - file.size;
        if (pad > 0) {
            parts.push(new Uint8Array(pad));
            at += pad;
        }
    }
    // Two empty blocks end a tar
    parts.push(new Uint8Array(1024));
    return {blob: new Blob(parts, {type: 'application/x-tar'}), ends};
}

// The 512 bytes that say one entry: name, mode, size, date, kind, and their checksum
function header_of(name, size, mtime_s, kind)
{
    const out = new Uint8Array(512);
    const bytes = new TextEncoder().encode(name);
    out.set(bytes.slice(0, 100), 0);
    field_set(out, 100, 8, '0000644');
    field_set(out, 108, 8, '0000000');
    field_set(out, 116, 8, '0000000');
    number_set(out, 124, size);
    field_set(out, 136, 12, mtime_s.toString(8).padStart(11, '0'));
    out[156] = kind.charCodeAt(0);
    field_set(out, 257, 6, 'ustar');
    field_set(out, 263, 2, '00');
    // The checksum is counted with its own eight bytes as spaces
    out.fill(32, 148, 156);
    const sum = out.reduce((total, v) => total + v, 0);
    field_set(out, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
    return out;
}

// A size in octal while it fits eleven digits (8 GB), and in base 256 past that, as GNU tar does
function number_set(header, offset, value)
{
    if (value < 8**11) {
        field_set(header, offset, 12, value.toString(8).padStart(11, '0'));
        return;
    }
    let left = value;
    for (let i = offset + 11; i > offset; i--) {
        header[i] = left % 256;
        left = Math.floor(left/256);
    }
    header[offset] = 0x80;
}

function field_set(header, offset, length, text)
{
    for (let i = 0; (i < text.length) && (i < length); i++) {
        header[offset + i] = text.charCodeAt(i);
    }
}

// 1 -> 512, 512 -> 512, 513 -> 1024: what a tar keeps for that many bytes
function block_size(bytes)
{
    return Math.ceil(bytes/512)*512;
}

export default tar_blob;
