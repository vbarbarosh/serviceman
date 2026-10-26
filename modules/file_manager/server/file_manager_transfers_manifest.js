// What the File Manager's copies hold and do, for their host to route, check and show: one
// kind, the copies between disks, made, given up, paused and resumed, and the list cleared of
// what is over
const file_manager_transfers_manifest = {
    module: 'file_manager',
    title: 'Copies',
    kinds: [
        {
            kind: '',
            said: 'a copy from one disk to another: from, to, how far, its state',
            id: '[0-9a-f]+',
            example: '9c1b7d4e',
            read: {},
            commands: [
                {command: 'create', on: 'kind', said: 'copy a file or a folder into a folder of a disk', body: ['from', 'to']},
                {command: 'cancel', on: 'item', said: 'give it up'},
                {command: 'clear', on: 'kind', said: 'take what is over off the list'},
                {command: 'pause', on: 'kind', said: 'stop the copy under way where it is, and start no other'},
                {command: 'resume', on: 'kind', said: 'carry on the copies paused'},
            ],
        },
    ],
    doors: [],
};

module.exports = file_manager_transfers_manifest;
