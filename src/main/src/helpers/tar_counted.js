const stream = require('stream');

// A tar is made of blocks of this many bytes
const BLOCK = 512;

// A tar of these items (tar_stream) as it goes, counted on the way through into a copy the page
// draws (service_copy_start): the bytes, the files that are in, the file on its way. Counted,
// never listened to: a listener would set the bytes flowing before anyone is there to take them.
// An error of the tar is the error of what it answers with.
//
//     items  [{path, dir: true}, {path, size}], as tar_stream takes them
//     copy   {bytes_done, files_done, now}, filled as the bytes pass
function tar_counted(tar, items, copy)
{
    const files = layout_of(items).files;
    let next = 0;
    const out = new stream.Transform({
        transform: function (chunk, encoding, callback) {
            copy.bytes_done += chunk.length;
            while ((next < files.length) && (files[next].begin + files[next].size <= copy.bytes_done)) {
                next++;
            }
            copy.files_done = next;
            const file = (next < files.length) ? files[next] : files.at(-1);
            if (file !== undefined) {
                copy.now = {label: file.path, size: file.size, done: Math.max(0, Math.min(file.size, copy.bytes_done - file.begin))};
            }
            callback(null, chunk);
        },
    });
    tar.on('error', e => out.destroy(e));
    tar.pipe(out);
    return out;
}

// How many bytes the tar of these items is
function size_of(items)
{
    return layout_of(items).total;
}

// Where each file of the tar begins: a block of header, then the file in whole blocks; a long
// name splits into ustar's prefix and takes no more. Two empty blocks end it.
function layout_of(items)
{
    const files = [];
    let at = 0;
    for (const item of items) {
        at += BLOCK;
        if (item.dir) {
            continue;
        }
        files.push({path: item.path, begin: at, size: item.size});
        at += Math.ceil(item.size/BLOCK)*BLOCK;
    }
    return {files, total: at + 2*BLOCK};
}

tar_counted.size_of = size_of;

module.exports = tar_counted;
