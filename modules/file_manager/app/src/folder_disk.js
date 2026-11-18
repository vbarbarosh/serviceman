const path = require('path');
const stream = require('stream');

// The words the agent refuses a path outside its root with, said here of the one folder
const RE_OUTSIDE = / is outside the folders this token may use/g;

// A disk whose `/` is one folder of the disk under it, as the File Manager asks for one: every
// path it is given is a path from that folder, and every path it answers with is one too. A
// path that climbs out of the folder (`/../etc`) is refused here, before the disk is asked; the
// disk under it is kept within the folder as well (remote_disk with `root`), and refuses what
// a link leads out of it to. The folder itself is `/`, and so is a path of '' or none.
//
//     disk    the disk under it: list, stat, read, tar, tree, watch, write, rename, remove,
//             mkdir, room, write_tar and the part calls, its paths absolute
//     root    the folder, an absolute path on that disk
function folder_disk(disk, root)
{
    return {
        list: async function (asked) {
            const answer = await said(root, () => disk.list(path_on_disk(root, asked)));
            return Object.assign({}, answer, {path: path_in_folder(root, answer.path)});
        },
        stat: function (asked) {
            return said(root, () => disk.stat(path_on_disk(root, asked)));
        },
        read: function (asked, range) {
            return stream_said(root, disk.read(path_on_disk(root, asked), range), null);
        },
        tar: function (dir, names, asked) {
            return stream_said(root, disk.tar(path_on_disk(root, dir), names, asked), null);
        },
        tree: function (dir, asked) {
            return stream_said(root, disk.tree(path_on_disk(root, dir), asked), null);
        },
        // The first line says the folder watched, from the folder too
        watch: function (dir, asked) {
            return stream_said(root, disk.watch(path_on_disk(root, dir), asked), v => ((v.type === 'ready') ? Object.assign({}, v, {path: path_in_folder(root, v.path)}) : v));
        },
        write: async function (dir, name, req) {
            const answer = await said(root, () => disk.write(path_on_disk(root, dir), name, req));
            return Object.assign({}, answer, {path: path_in_folder(root, answer.path)});
        },
        rename: function (from, to) {
            return said(root, () => disk.rename(path_not_root(root, from, 'moved'), path_on_disk(root, to)));
        },
        remove: function (asked) {
            return said(root, () => disk.remove(path_not_root(root, asked, 'deleted')));
        },
        mkdir: function (asked) {
            return said(root, () => disk.mkdir(path_on_disk(root, asked)));
        },
        room: function (dir) {
            return said(root, () => disk.room(path_on_disk(root, dir)));
        },
        write_tar: function (dir, source, taken) {
            return said(root, () => disk.write_tar(path_on_disk(root, dir), source, taken));
        },
        part_stat: function (dir, name, id) {
            return said(root, () => disk.part_stat(path_on_disk(root, dir), name, id));
        },
        part_write: function (dir, name, id, offset, source, taken) {
            return said(root, () => disk.part_write(path_on_disk(root, dir), name, id, offset, source, taken));
        },
        part_finish: async function (dir, name, id, size, mode) {
            const answer = await said(root, () => disk.part_finish(path_on_disk(root, dir), name, id, size, mode));
            return Object.assign({}, answer, {path: path_in_folder(root, answer.path)});
        },
        part_remove: function (dir, name, id) {
            return said(root, () => disk.part_remove(path_on_disk(root, dir), name, id));
        },
    };
}

// Where a path of the folder is on the disk under it: `/a/b`, `a/b` and `//a/b` are all
// `<root>/a/b`, and '' or none is the root. A path whose `..` leads out of the folder is
// refused, in the words the disk under it has for a path outside its root.
function path_on_disk(root, asked)
{
    if ((asked === null) || (asked === undefined) || (asked === '')) {
        return root;
    }
    // resolve, not join: `/docs/` is `<root>/docs`, as the disk under it names it
    const full = path.posix.resolve(root, `./${asked}`);
    const inside = path.posix.relative(root, full);
    if ((inside === '..') || inside.startsWith('../')) {
        throw Object.assign(new Error(`EACCES: ${JSON.stringify(String(asked))} is outside the root folder`), {code: 'EACCES'});
    }
    return full;
}

// The root folder holds everything the folder disk is: it is never deleted or moved, as `rm -r /`
// is refused on a machine; what is in it is
function path_not_root(root, asked, done)
{
    const full = path_on_disk(root, asked);
    if (full === root) {
        throw new Error(`the root folder itself is not ${done}: what is in it is`);
    }
    return full;
}

// A path of the disk under it as the folder names it: the root is `/`
function path_in_folder(root, full)
{
    if (typeof full !== 'string') {
        return full;
    }
    const inside = path.posix.relative(root, full);
    if ((inside === '..') || inside.startsWith('../')) {
        return full;
    }
    return `/${inside}`;
}

// What the disk under it answered, or what it refused with, its paths said from the folder
async function said(root, call)
{
    try {
        return await call();
    }
    catch (error) {
        throw Object.assign(new Error(text_in_folder(root, error.message)), {code: error.code});
    }
}

// A stream of the disk under it, handed on as it comes and stopped with its reader; what it
// fails with is said from the folder. With line_map, each of its JSON lines goes through it.
function stream_said(root, source, line_map)
{
    const out = (line_map === null) ? new stream.PassThrough() : lines_mapped(line_map);
    source.on('error', function (error) {
        out.destroy(new Error(text_in_folder(root, error.message)));
    });
    out.on('close', function () {
        source.destroy();
    });
    source.pipe(out);
    return out;
}

// JSON lines in, each one mapped, JSON lines out; a line that does not read goes on as it was,
// for the reader to refuse
function lines_mapped(line_map)
{
    let rest = '';
    return new stream.Transform({
        transform: function (chunk, encoding, done) {
            const lines = (rest + chunk.toString('utf8')).split('\n');
            rest = lines.pop();
            done(null, lines.map(v => `${line_mapped(v, line_map)}\n`).join(''));
        },
        flush: function (done) {
            done(null, (rest === '') ? '' : line_mapped(rest, line_map));
        },
    });
}

function line_mapped(line, line_map)
{
    let value;
    try {
        value = JSON.parse(line);
    }
    catch {
        return line;
    }
    if ((value === null) || (typeof value !== 'object')) {
        return line;
    }
    return JSON.stringify(line_map(value));
}

// A message of the disk under it with the folder's paths in it said from the folder: the root
// is `/`, and what the disk calls outside its root is outside the root folder
function text_in_folder(root, text)
{
    const words = String(text).replace(RE_OUTSIDE, ' is outside the root folder');
    if (root === '/') {
        return words;
    }
    return words.split(`${root}/`).join('/').replace(new RegExp(`${regex_escaped(root)}(?![^'"\\s,:;)\\]])`, 'g'), '/');
}

function regex_escaped(text)
{
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = folder_disk;
