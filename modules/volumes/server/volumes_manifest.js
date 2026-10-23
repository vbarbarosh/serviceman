// What the Volumes module holds and does, for its host to route, check and show: one kind, the
// encrypted volumes of the machine, made, opened, closed, grown and deleted. Its columns are how
// a page draws them (items_view), the first to fold the lowest.
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
            key: 'name',
            search: ['name', 'target'],
            columns: [
                {key: 'name', label: 'Volume', as: 'code', wraps: true, sort: true},
                {key: 'target', label: 'Folder', as: 'code', fold: 1},
                {key: 'state', label: 'State', sort: true},
                {key: 'used', label: 'Used', as: 'share', of: 'size', levels: [0.75, 0.9], fold: 3, sort: true},
            ],
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
