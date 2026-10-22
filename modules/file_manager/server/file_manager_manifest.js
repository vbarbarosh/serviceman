// What the File Manager holds and does, for its host to route, check and show: the files of one
// disk, a folder listed at a time, renamed, deleted and made, each named in the body by its
// path. Reading and writing a file is a stream rather than a command, and so is a folder
// watched: those are its doors. A host that gives a right to it gives the whole of it.
const file_manager_manifest = {
    module: 'file_manager',
    title: 'File Manager',
    right: {right: 'files', said: 'use the files'},
    kinds: [
        {
            kind: '',
            said: 'a file or a folder: its name, size, time and mode; one folder at a time (query: path), or a whole tree (tree=1)',
            read: {},
            commands: [
                {command: 'mkdir', on: 'kind', said: 'make a folder', body: ['path']},
                {command: 'rename', on: 'kind', said: 'rename or move one', body: ['from', 'to']},
                {command: 'delete', on: 'kind', said: 'delete one, a folder with all in it', body: ['path'], danger: true},
            ],
        },
    ],
    doors: [
        {door: 'file/<path>', re: '^/file/.*$', methods: ['GET'], said: 'a file, read whole or by range'},
        {door: 'tar', re: '^/tar$', methods: ['GET'], said: 'a folder or several files as one tar'},
        {door: 'watch', re: '^/watch$', methods: ['GET'], said: 'a folder watched: events as they happen'},
        {door: 'room', re: '^/room$', methods: ['GET'], said: 'the room left on the disk'},
        {door: 'upload', re: '^/upload$', methods: ['POST'], said: 'a file written whole'},
        {door: 'upload/tar', re: '^/upload/tar$', methods: ['POST'], said: 'many files written from one tar'},
        {door: 'upload/part', re: '^/upload/part$', methods: ['GET', 'POST'], said: 'a big file written a part at a time'},
        {door: 'upload/finish', re: '^/upload/(finish|cancel)$', methods: ['POST'], said: 'a file in parts finished, or given up'},
    ],
};

module.exports = file_manager_manifest;
