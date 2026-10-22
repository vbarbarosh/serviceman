// What the Disks module holds and does, for its host to route, check and show: one kind, the
// mounted file systems of the machine, read and nothing else
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
            commands: [],
        },
    ],
    doors: [],
};

module.exports = disks_manifest;
