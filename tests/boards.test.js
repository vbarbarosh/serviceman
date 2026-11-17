const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const board_rules = require('../src/main/src/helpers/board_rules');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const doors_table = require('../src/main/src/helpers/doors_table');
const service_rename_ties = require('../src/main/src/helpers/service_rename_ties');
const test = require('node:test');

const SERVICES = [
    {name: 'notes', type: 'files', publish: {host: 'notes.localhost'}},
    {name: 'mail_box', type: 'files', publish: {host: 'mail-box.localhost'}},
];

function config_of(boards)
{
    return config_from_json({remotes: [{name: 'laptop', token: 'a'.repeat(32)}, {name: 'vps1', token: 'b'.repeat(32)}], services: SERVICES, boards}, __dirname);
}

// A board names the machines it is on and the apps it shows, in order; 3000 unless a port is said
test('a board is read with its machines, its apps in order and its port', function () {
    assert.deepStrictEqual(config_of(undefined).boards, []);
    assert.deepStrictEqual(config_of([{name: 'apps', machines: ['laptop'], apps: ['notes', 'mail_box']}]).boards, [
        {name: 'apps', machines: ['laptop'], apps: ['notes', 'mail_box'], port: 3000},
    ]);
    assert.strictEqual(config_of([{name: 'apps', port: 4100}]).boards[0].port, 4100);
});

// What the config says is wrong with a board, in its own words
test('the config says what is wrong with a board', function () {
    const cases = [
        [{}, /boards: a list of boards/],
        [[{name: 'Apps'}], /boards\[0\]\.name: its name under \.localhost, lowercase letters, digits and hyphens/],
        [[{name: 'a_b'}], /boards\[0\]\.name/],
        [[{name: 'apps'}, {name: 'apps'}], /boards\[1\]\.name: "apps" is used twice/],
        [[{name: 'apps', machines: 'laptop'}], /boards\[0\]\.machines: the machines it is published on/],
        [[{name: 'apps', apps: ['notes', 'notes']}], /boards\[0\]\.apps: "notes" is there twice/],
        [[{name: 'apps', port: 0}], /boards\[0\]\.port: a port from 1 to 65535/],
        [[{name: 'apps', color: 'red'}], /boards\[0\]\.color: not a field of a board/],
        [[{name: 'apps', machines: ['phone']}], /boards\[0\]\.machines: no remote named "phone"/],
        [[{name: 'apps', apps: ['wiki']}], /boards\[0\]\.apps: no service named "wiki"/],
        [[{name: 'notes', machines: ['laptop'], apps: ['notes']}], /on laptop, notes\.localhost is the board notes and the app notes at once/],
        [[{name: 'apps', machines: ['laptop']}, {name: 'notes', machines: ['laptop']}, {name: 'more', machines: ['laptop'], apps: ['notes']}], /boards\[2\]: on laptop, notes\.localhost is the board notes and the app notes/],
    ];
    for (const [boards, message] of cases) {
        assert.throws(() => config_of(boards), message, JSON.stringify(boards));
    }
    // One app on two boards of one machine is the same name for the same app
    assert.strictEqual(config_of([{name: 'a', machines: ['laptop'], apps: ['notes']}, {name: 'b', machines: ['laptop'], apps: ['notes']}]).boards.length, 2);
});

// A machine's door gets its boards' names, and the ports to answer them on; another machine none
test('a machine\'s table has its boards\' names and ports, and nothing of a board not on it', function () {
    const app = app_from_config(config_of([
        {name: 'apps', machines: ['laptop'], apps: ['mail_box', 'notes']},
        {name: 'work', machines: ['laptop'], apps: ['notes'], port: 4100},
    ]));
    assert.deepStrictEqual(board_rules(app, 'laptop'), {
        rules: {
            'apps.localhost': {service: '*', off: false, auth: null, board: 'apps'},
            'mail-box.localhost': {service: 'mail_box', off: false, auth: null},
            'notes.localhost': {service: 'notes', off: false, auth: null},
            'work.localhost': {service: '*', off: false, auth: null, board: 'work'},
        },
        ports: [3000, 4100],
    });
    const laptop = doors_table(app, app.remote_by_name.laptop);
    assert.deepStrictEqual(laptop.local, {ports: [3000, 4100]});
    assert.deepStrictEqual(laptop.names['apps.localhost'], {service: '*', wall: null, off: false});
    assert.deepStrictEqual(laptop.names['notes.localhost'], {service: 'notes', wall: null, off: false});
    const vps1 = doors_table(app, app.remote_by_name.vps1);
    assert.strictEqual(vps1.local, undefined);
    assert.deepStrictEqual(vps1.names, {});
});

// A renamed app keeps its place on every board it is on
test('a renamed app keeps its place on its boards', function () {
    const json = {boards: [{name: 'apps', apps: ['mail_box', 'notes']}, {name: 'work', apps: ['notes']}]};
    service_rename_ties({}, json, 'notes', 'wiki');
    assert.deepStrictEqual(json.boards.map(v => v.apps), [['mail_box', 'wiki'], ['wiki']]);
});
