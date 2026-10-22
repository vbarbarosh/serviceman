// What the Processes module holds and does, for its host to route, check and show: one kind,
// the processes of the machine, read and nothing else
const processes_manifest = {
    module: 'processes',
    title: 'Processes',
    kinds: [
        {
            kind: '',
            said: 'a process: its pid, parent, user, CPU, memory, how long it has run, its command',
            id: '[0-9]+',
            example: '1234',
            read: {right: {right: 'processes', said: 'read the processes'}},
            commands: [],
        },
    ],
    doors: [],
};

module.exports = processes_manifest;
