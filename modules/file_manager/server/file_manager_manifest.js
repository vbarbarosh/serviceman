// What the File Manager holds and does, for its host to route, check and show: the files of one
// disk, a folder listed at a time, renamed, deleted and made, each named in the body by its
// path. Reading and writing a file is a stream rather than a command, and so is a folder
// watched: those are its doors. A host gives a right to read them, or one to read and write
// them, the read under it; asking which parts of a file sent in parts are in is the write's.
const READ = {right: 'files_read', said: 'read the files', under: 'files'};
const WRITE = {right: 'files', said: 'write the files'};

const file_manager_manifest = {
    module: 'file_manager',
    title: 'File Manager',
    kinds: [
        {
            kind: '',
            said: 'a file or a folder: its name, size, time and mode; one folder at a time (query: path), or a whole tree (tree=1)',
            read: {right: READ},
            commands: [
                {command: 'mkdir', on: 'kind', said: 'make a folder', body: ['path'], right: WRITE},
                {command: 'rename', on: 'kind', said: 'rename or move one', body: ['from', 'to'], right: WRITE},
                {command: 'delete', on: 'kind', said: 'delete one, a folder with all in it', body: ['path'], danger: true, right: WRITE},
            ],
        },
    ],
    doors: [
        {door: 'file/<path>', re: '^/file/.*$', methods: ['GET'], said: 'a file, read whole or by range', right: READ},
        {door: 'tar', re: '^/tar$', methods: ['GET'], said: 'a folder or several files as one tar', right: READ},
        {door: 'watch', re: '^/watch$', methods: ['GET'], said: 'a folder watched: events as they happen', right: READ},
        {door: 'room', re: '^/room$', methods: ['GET'], said: 'the room left on the disk', right: READ},
        {door: 'upload', re: '^/upload$', methods: ['POST'], said: 'a file written whole', right: WRITE},
        {door: 'upload/tar', re: '^/upload/tar$', methods: ['POST'], said: 'many files written from one tar', right: WRITE},
        {door: 'upload/part', re: '^/upload/part$', methods: ['GET', 'POST'], said: 'a big file written a part at a time', right: WRITE},
        {door: 'upload/finish', re: '^/upload/(finish|cancel)$', methods: ['POST'], said: 'a file in parts finished, or given up', right: WRITE},
    ],
};

module.exports = file_manager_manifest;
