// What the Volumes module holds and does, for its host to route, check and show: one kind, the
// encrypted volumes of the machine, made, opened, closed, grown and deleted
const volumes_manifest = {
    module: 'volumes',
    title: 'Volumes',
    kinds: [
        {
            kind: '',
            said: 'an encrypted volume: its name, owner, where it opens, open or closed, its size and use',
            id: '[a-z0-9][a-z0-9-]{0,39}',
            example: 'notes',
            read: {},
            commands: [
                {command: 'create', on: 'kind', said: 'make a volume', body: ['name', 'owner', 'target', 'size', 'key', 'passphrase', 'plain_remove']},
                {command: 'open', on: 'item', said: 'open it with its key', body: ['key']},
                {command: 'close', on: 'item', said: 'close it'},
                {command: 'grow', on: 'item', said: 'make it bigger', body: ['size']},
                {command: 'delete', on: 'item', said: 'delete it and what is in it', danger: true},
            ],
        },
    ],
    doors: [],
};

module.exports = volumes_manifest;
