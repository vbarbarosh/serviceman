// What the Firewall module holds and does, for its host to route, check and show: the firewall
// itself, switched on and off; its rules, each the command that made it, added and deleted; and
// the ports the machine listens on, read
const firewall_manifest = {
    module: 'firewall',
    title: 'Firewall',
    kinds: [
        {
            kind: '',
            said: 'the firewall: whether ufw is there and on, its defaults, its rules',
            read: {},
            commands: [
                {command: 'enable', on: 'kind', said: 'switch it on'},
                {command: 'disable', on: 'kind', said: 'switch it off', danger: true},
            ],
        },
        {
            kind: 'rules',
            said: 'a rule, as the command that made it: allow 22/tcp',
            read: {},
            key: 'command',
            search: ['command', 'comment'],
            columns: [
                {key: 'action', label: 'Action'},
                {key: 'port', label: 'Port'},
                {key: 'from', label: 'From', fold: 3},
                {key: 'to', label: 'To', fold: 2, muted: true},
                {key: 'comment', label: 'Comment', fold: 1, muted: true},
            ],
            commands: [
                {command: 'create', on: 'kind', said: 'add a rule, from the form or again from its command', body: ['action', 'direction', 'port', 'proto', 'from', 'comment', 'command', 'at']},
                {command: 'delete', on: 'kind', said: 'delete the rule named by its command', body: ['command'], danger: true},
            ],
        },
        {
            kind: 'ports',
            said: 'a socket the machine listens on: its protocol, address, port and the programs on it',
            read: {},
            search: ['port', 'address'],
            sort: {key: 'port', down: false},
            columns: [
                {key: 'port', label: 'Port', sort: true},
                {key: 'proto', label: 'Protocol', fold: 3, muted: true},
                {key: 'address', label: 'Address', as: 'code', fold: 2},
                {key: 'state', label: 'State', fold: 1, muted: true},
            ],
            commands: [],
        },
    ],
    doors: [],
};

module.exports = firewall_manifest;
