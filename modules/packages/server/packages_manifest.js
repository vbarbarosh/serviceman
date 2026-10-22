// What the Packages module holds and does, for its host to route, check and show: one kind,
// the packages of the machine, and installing what waits for all of them at once. The upgrade
// is a run of minutes: it is started, read back while it goes, and stopped.
const packages_manifest = {
    module: 'packages',
    title: 'Packages',
    kinds: [
        {
            kind: '',
            said: 'an installed package: its name, version, size, whether it was asked for, and the update that waits, if one does',
            id: '[a-z0-9][a-z0-9+.:-]*',
            example: 'openssl',
            read: {right: {right: 'packages', said: 'read the packages'}},
            commands: [
                {command: 'upgrade', on: 'kind', said: 'install everything that waits', answer: 'run'},
                {command: 'cancel', on: 'kind', said: 'stop the upgrade under way'},
            ],
        },
    ],
    doors: [],
};

module.exports = packages_manifest;
