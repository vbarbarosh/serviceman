// What the Processes module holds and does, for its host to route, check and show: one kind,
// the processes of the machine, read and nothing else. Its columns are how a page draws them
// (items_view): each under the one that started it, Command and State never folded, User
// first and CPU last.
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
            key: 'pid',
            search: ['command', 'user', 'pid'],
            tree: {id: 'pid', parent: 'ppid'},
            sort: {key: 'cpu', down: true},
            columns: [
                {key: 'command', label: 'Command', as: 'code', clip: true},
                {key: 'pid', label: 'PID', fold: 2},
                {key: 'user', label: 'User', fold: 1, sort: true},
                {key: 'cpu', label: 'CPU', as: 'percent', fold: 6, sort: true},
                {key: 'mem', label: 'Memory', as: 'percent', full: 25, fold: 5, sort: true},
                {key: 'rss', label: 'RSS', as: 'bytes', fold: 4, sort: true},
                {key: 'elapsed_ms', label: 'Running', as: 'duration', fold: 3, sort: true},
                {key: 'state', label: 'State', muted: true},
            ],
            commands: [],
        },
    ],
    doors: [],
};

module.exports = processes_manifest;
