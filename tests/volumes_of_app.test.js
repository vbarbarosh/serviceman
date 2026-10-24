const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const test = require('node:test');
const volumes_of_app = require('../src/main/src/helpers/volumes_of_app');

const TOKEN = '0123456789abcdef0123456789abcdef';

// An app folder keeps its data/ without being told: Storage lists it with what services keep
test('an app folder\'s data/ is kept, listed with the folders the services name', function () {
    const config = config_from_json({
        remotes: [{name: 'vps1', token: TOKEN}],
        services: [
            {name: 'notes', type: 'shell', remote: 'vps1', command: 'bin/run', cwd: '/srv/apps/notes', publish: {host: 'notes.localhost', port: 8080}},
            {name: 'grafana', type: 'docker', remote: 'vps1', image: 'grafana/grafana', volumes: [':/var/lib/grafana'], publish: {host: 'grafana.localhost', port: 3000}},
            {name: 'tool', type: 'shell', remote: 'vps1', command: 'node tool.js', cwd: '/srv/tool', publish: {host: 'tool.localhost', port: 8081}},
        ],
    }, __dirname);
    const kept = volumes_of_app({services: config.services});
    assert.deepStrictEqual(kept.map(v => [v.name, v.kind, v.machine, v.used_by.map(vv => `${vv.service} ${vv.at}`)]), [
        ['/srv/apps/notes/data', 'app', 'vps1', ['notes data/']],
        ['data/grafana/var-lib-grafana', 'kept', 'vps1', ['grafana /var/lib/grafana']],
    ]);
});
