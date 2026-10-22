// What the Docker module holds and does, for its host to route, check and show: the containers,
// the compose projects they came from, the images, volumes and networks, and what is done to
// each. A long command answers a stream of its lines, or the lines themselves where the host
// keeps no streams (answer: stream).
const docker_manifest = {
    module: 'docker',
    title: 'Docker',
    kinds: [
        {
            kind: 'containers',
            said: 'a container: its name, image, state, ports and compose project',
            id: '[0-9a-f]{12,64}',
            example: '3f2a9c1b7d4e',
            read: {right: {right: 'containers', said: 'read the containers'}},
            commands: [
                {command: 'start', on: 'item', said: 'start it'},
                {command: 'stop', on: 'item', said: 'stop it'},
                {command: 'restart', on: 'item', said: 'restart it'},
                {command: 'remove', on: 'item', said: 'remove it, once stopped', danger: true},
            ],
        },
        {
            kind: 'projects',
            said: 'a compose project, by name, as its containers\' labels say; listed with them',
            id: '[^/]+',
            example: 'web',
            commands: [
                {command: 'update', on: 'item', said: 'pull its images, make again what changed', answer: 'stream'},
                {command: 'recreate', on: 'item', said: 'pull its images, take it down, bring it up', answer: 'stream'},
            ],
        },
        {
            kind: 'images',
            said: 'an image: its tags, size, and the containers made from it',
            id: 'sha256:[0-9a-f]{64}|[0-9a-f]{12,64}',
            example: 'sha256:5d0da3dc976460b72c77d94c8a1ad043720b0416bfc16c52c45d4847e53fadb6',
            read: {},
            commands: [
                {command: 'pull', on: 'item', said: 'pull it again under its first tag', answer: 'stream'},
                {command: 'remove', on: 'item', said: 'remove it', danger: true},
                {command: 'prune', on: 'kind', said: 'remove the dangling ones, or with all=1 every one no container uses', query: ['all'], answer: 'stream', danger: true},
            ],
        },
        {
            kind: 'volumes',
            said: 'a volume: its name, size, and the containers that mount it',
            id: '[^/]+',
            example: 'web_data',
            read: {},
            commands: [
                {command: 'open', on: 'item', said: 'mount it in a helper, for its files to be read'},
                {command: 'close', on: 'item', said: 'let the helper go'},
                {command: 'remove', on: 'item', said: 'remove it and what is in it', danger: true},
                {command: 'prune', on: 'kind', said: 'remove every one no container mounts', answer: 'stream', danger: true},
            ],
        },
        {
            kind: 'networks',
            said: 'a network: its name, driver, and the containers on it',
            id: '[0-9a-f]{12,64}',
            example: '7b1d2e3f4a5c',
            read: {},
            commands: [
                {command: 'remove', on: 'item', said: 'remove it', danger: true},
                {command: 'prune', on: 'kind', said: 'remove every one no container is on, the built-in ones aside', answer: 'stream', danger: true},
            ],
        },
    ],
    doors: [
        {door: 'containers/<id>/fs', re: '^/containers/[0-9a-f]{12,64}/fs(/.*)?$', methods: ['GET', 'POST'], said: 'a container\'s files, through the File Manager\'s API'},
    ],
};

module.exports = docker_manifest;
