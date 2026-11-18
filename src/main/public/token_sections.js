// The sections a token's rights are given by on the Tokens page, each set to none, read or
// write at once, its rights one by one under "fine". Every right serviceman has is in one of
// them (control_route_right.RIGHTS), in the order its fine ticks show them.
//
//     rights    the section's rights
//     read      what read gives; null where there is no read alone, said in no_read
//     write     what write gives; null where nothing in it writes, said in no_write
//     under     a read alone and the right it is under, which holds it too: files holds
//               files_read (control_route_right)
const token_sections = [
    {
        value: 'machines',
        label: 'Machines',
        said: 'what runs on them, the charts, processes, ports, disks, packages, containers and the CVEs that hit them',
        rights: ['status', 'metrics', 'processes', 'ports', 'disks', 'packages', 'containers', 'vulnerabilities'],
        read: ['status', 'metrics', 'processes', 'ports', 'disks', 'packages', 'containers', 'vulnerabilities'],
        write: null,
        no_write: 'no write: what changes a machine stays the owner\'s',
        under: {},
    },
    {
        value: 'files',
        label: 'Files',
        said: 'the file manager, within the folders below and nothing above them',
        rights: ['files_read', 'files'],
        read: ['files_read'],
        write: ['files'],
        under: {files_read: 'files'},
    },
    {
        value: 'terminals',
        label: 'Terminals',
        said: 'its kept terminals: a shell on the machine, which goes anywhere',
        rights: ['terminals'],
        read: null,
        no_read: 'no read: a shell writes',
        write: ['terminals'],
        under: {},
    },
    {
        value: 'apps',
        label: 'Apps',
        said: 'apps of files and on a socket, and new versions of the app folders on its machines',
        rights: ['apps_read', 'apps', 'versions'],
        read: ['apps_read'],
        write: ['apps', 'versions'],
        under: {apps_read: 'apps'},
    },
    {
        value: 'forwards',
        label: 'Forwards',
        said: 'the forwards between its machines: a way to what listens there, as an ssh tunnel is',
        rights: ['forwards_read', 'forwards'],
        read: ['forwards_read'],
        write: ['forwards'],
        under: {forwards_read: 'forwards'},
    },
];

export default token_sections;
