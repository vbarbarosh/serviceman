// Files as one ustar tar, made in the page for the File Manager's tar upload: a folder as its
// name, a file as its name, mode, time and bytes. A name longer than ustar's hundred bytes is
// split into its prefix at a slash; one that cannot be is refused.
//
//     [{path, dir: true}, {path, mode, mtime_s, bytes}], bytes a Uint8Array or a Blob

const BLOCK = 512;

function tar_blob(items)
{
    const parts = [];
    for (const item of items) {
        if (item.dir) {
            parts.push(header(item.path.replace(/\/*$/, '/'), 0o755, item.mtime_s || 0, 0, '5'));
            continue;
        }
        // A file of a folder picked in the page stays a Blob: the tar reads it only as it is sent
        const size = (item.bytes instanceof Blob) ? item.bytes.size : item.bytes.length;
        parts.push(header(item.path, item.mode, item.mtime_s, size, '0'));
        parts.push(item.bytes);
        parts.push(new Uint8Array((BLOCK - (size % BLOCK)) % BLOCK));
    }
    // A tar ends with two empty blocks
    parts.push(new Uint8Array(BLOCK*2));
    return new Blob(parts, {type: 'application/x-tar'});
}

function header(path, mode, mtime_s, size, type)
{
    const out = new Uint8Array(BLOCK);
    const name = name_split(path);
    text_put(out, 0, 100, name.name);
    text_put(out, 100, 8, octal(mode, 7));
    text_put(out, 108, 8, octal(0, 7));
    text_put(out, 116, 8, octal(0, 7));
    text_put(out, 124, 12, octal(size, 11));
    text_put(out, 136, 12, octal(Math.max(0, mtime_s), 11));
    text_put(out, 156, 1, type);
    text_put(out, 257, 6, 'ustar');
    text_put(out, 263, 2, '00');
    text_put(out, 345, 155, name.prefix);
    // The checksum is summed with its own field as spaces
    out.fill(0x20, 148, 156);
    const sum = out.reduce((total, v) => total + v, 0);
    text_put(out, 148, 8, `${octal(sum, 6)}\0 `);
    return out;
}

// ustar keeps a long name as a prefix of up to 155 bytes and a name of up to 100, joined by a slash
function name_split(path)
{
    const bytes = new TextEncoder().encode(path);
    if (bytes.length <= 100) {
        return {prefix: '', name: path};
    }
    for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1)) {
        const prefix = path.slice(0, at);
        const name = path.slice(at + 1);
        if ((new TextEncoder().encode(prefix).length <= 155) && (new TextEncoder().encode(name).length <= 100)) {
            return {prefix, name};
        }
    }
    throw new Error(`${path} is too long a name to send`);
}

function octal(value, digits)
{
    return value.toString(8).padStart(digits, '0');
}

function text_put(block, at, length, text)
{
    block.set(new TextEncoder().encode(text).subarray(0, length), at);
}

export default tar_blob;
