const remote_call = require('./remote_call');
const tunnel_open = require('./tunnel_open');

// A folder is a handful of names over a link that is already up; the wait is for a machine
// thinking about it
const FS_TIMEOUT_MS = 15000;

// The disk of one machine as the File Manager module asks for it. Every call goes over the
// link its agent dialled, and the bytes are kept nowhere on this host. The agent answers as
// its own user, and ~ is that user's home.
function remote_disk(app, remote)
{
    return {
        list: function (asked) {
            return remote_call(app, remote, 'fs_list', {path: (((asked === null) || (asked === '')) ? '~' : asked)}, FS_TIMEOUT_MS);
        },
        stat: function (asked) {
            return remote_call(app, remote, 'fs_stat', {path: asked}, FS_TIMEOUT_MS);
        },
        read: function (asked, range) {
            return tunnel_open(remote, {read: Object.assign({path: asked}, ((range === null) ? {} : {start: range.start, end: range.end}))});
        },
        tar: function (dir, names) {
            return tunnel_open(remote, {tar: {dir: ((dir === '') ? '~' : dir), names}});
        },
        tree: function (dir, options) {
            return tunnel_open(remote, {tree: {path: (((dir === null) || (dir === '')) ? '~' : dir), hash: options.hash, skip: options.skip}});
        },
        watch: function (dir, options) {
            return tunnel_open(remote, {watch: {path: (((dir === null) || (dir === '')) ? '~' : dir), tree: options.tree, skip: options.skip}});
        },
        write: async function (dir, name, req) {
            try {
                return await file_send(remote, {file: {dir, name}}, req);
            }
            catch (error) {
                throw new Error(`${remote.name}: ${error.message}`);
            }
        },
        rename: function (from, to) {
            return remote_call(app, remote, 'fs_rename', {from, to}, FS_TIMEOUT_MS);
        },
        remove: function (asked) {
            return remote_call(app, remote, 'fs_delete', {path: asked}, FS_TIMEOUT_MS);
        },
        mkdir: function (asked) {
            return remote_call(app, remote, 'dir_create', {path: asked}, FS_TIMEOUT_MS);
        },
        part_stat: function (dir, name, id) {
            return remote_call(app, remote, 'file_part_stat', {dir, name, id}, FS_TIMEOUT_MS);
        },
        part_write: function (dir, name, id, offset, source) {
            return file_send(remote, {part: {dir, name, id, offset}}, source);
        },
        part_finish: function (dir, name, id, size) {
            return remote_call(app, remote, 'file_part_finish', {dir, name, id, size}, FS_TIMEOUT_MS);
        },
        part_remove: function (dir, name, id) {
            return remote_call(app, remote, 'file_part_remove', {dir, name, id}, FS_TIMEOUT_MS);
        },
    };
}

// The bytes of one file, or of one part of it, into a stream whose far end is that file. What
// comes back is the one line the machine writes when they are in — where the file landed and
// how big it is, or how much of it is in so far. The bytes come from a browser's request, or
// from a file read on another machine.
function file_send(remote, target, source)
{
    return new Promise(function (resolve, reject) {
        const stream = tunnel_open(remote, target);
        const said = [];
        stream.on('data', function (chunk) {
            said.push(chunk);
        });
        stream.on('error', reject);
        stream.on('end', function () {
            const text = Buffer.concat(said).toString('utf8').trim();
            if (text === '') {
                reject(new Error('the machine said nothing about the file'));
                return;
            }
            resolve(JSON.parse(text));
        });
        // Whoever was sending it hung up: the machine is left with nothing rather than the
        // half of a file that arrived — and a part with as much as was written, which the next
        // part asks about
        source.on('aborted', function () {
            stream.destroy();
            reject(new Error('the copy was given up before the file was in'));
        });
        source.on('error', function (error) {
            stream.destroy();
            reject(error);
        });
        source.pipe(stream);
    });
}

module.exports = remote_disk;
