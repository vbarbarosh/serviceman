const stream = require('stream');

// Files as one ustar tar, as the page makes one for the File Manager's tar upload
// (src/main/public/tar_blob.js): a folder as its name, a file as its name, mode, time and
// bytes. It is made as it is read, one file at a time, so a tar of gigabytes holds no more
// than a chunk of one in memory. A name longer than ustar's hundred bytes is split into its
// prefix at a slash; one that cannot be is refused.
//
//     [{path, dir: true, mtime_s}, {path, mode, mtime_s, size, stream()}]
//     stream()  the file's bytes, a Readable of exactly size bytes

const BLOCK = 512;

function tar_stream(items)
{
    return stream.Readable.from(tar_chunks(items), {objectMode: false});
}

async function* tar_chunks(items)
{
    for (const item of items) {
        if (item.dir) {
            yield header(item.path.replace(/\/*$/, '/'), 0o755, item.mtime_s || 0, 0, '5');
            continue;
        }
        yield header(item.path, item.mode, item.mtime_s, item.size, '0');
        yield* item.stream();
        yield Buffer.alloc((BLOCK - (item.size % BLOCK)) % BLOCK);
    }
    // A tar ends with two empty blocks
    yield Buffer.alloc(BLOCK*2);
}

function header(path, mode, mtime_s, size, type)
{
    const out = Buffer.alloc(BLOCK);
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
    if (Buffer.byteLength(path) <= 100) {
        return {prefix: '', name: path};
    }
    for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1)) {
        const prefix = path.slice(0, at);
        const name = path.slice(at + 1);
        if ((Buffer.byteLength(prefix) <= 155) && (Buffer.byteLength(name) <= 100)) {
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
    block.write(text, at, length, 'utf8');
}

module.exports = tar_stream;
