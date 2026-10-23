// What the Disks module holds and does, for its host to route, check and show: one kind, the
// mounted file systems of the machine, read and nothing else. Its columns are how a page draws
// them (items_view): Disk and Space used never folded, Inodes free first and Free last.
const disks_manifest = {
    module: 'disks',
    title: 'Disks',
    kinds: [
        {
            kind: '',
            said: 'a disk: its device, type, where it is mounted, its size, use and inodes',
            id: '.+',
            example: '/dev/sda1',
            read: {right: {right: 'disks', said: 'read the disks'}},
            key: ['device', 'mounts'],
            search: ['device', 'mounts', 'type'],
            columns: [
                {key: 'device', label: 'Disk', as: 'code', wraps: true},
                {key: 'mounts', label: 'Mounted at', fold: 4},
                {key: 'type', label: 'Type', fold: 3},
                {key: 'used', label: 'Space used', as: 'share', of: 'total', levels: [0.75, 0.9], sort: true},
                {key: 'free', label: 'Free', as: 'bytes', fold: 5, sort: true},
                {key: 'inodes_used', label: 'Inodes used', as: 'share', of: 'inodes_total', unit: 'count', levels: [0.75, 0.9], none: 'not counted', fold: 2},
                {key: 'inodes_free', label: 'Inodes free', as: 'count', none: 'not counted', fold: 1},
            ],
            commands: [],
        },
    ],
    doors: [],
};

module.exports = disks_manifest;
