// What the Terminal module holds and does, for its host to route, check and show: one kind, the
// kept terminals of the machine, made, signalled and ended. Joining one is the WebSocket of
// terminal_attach, not a door of this API.
const RIGHT = {right: 'terminals', said: 'use the terminals'};

const terminal_manifest = {
    module: 'terminal',
    title: 'Terminal',
    kinds: [
        {
            kind: '',
            said: 'a kept terminal: its name, when it was made, how many have joined it, its folder',
            id: '[A-Za-z0-9_-]{1,64}',
            example: 'work',
            read: {right: RIGHT},
            commands: [
                {command: 'create', on: 'kind', said: 'make one, named or the next free number', body: ['name', 'cols', 'rows', 'env', 'cwd'], right: RIGHT},
                {command: 'signal', on: 'item', said: 'send a signal to its shell, or to what runs in front', body: ['signal', 'to'], right: RIGHT},
                {command: 'end', on: 'item', said: 'hang up its shell; the terminal is gone', danger: true, right: RIGHT},
            ],
        },
    ],
    doors: [],
};

module.exports = terminal_manifest;
