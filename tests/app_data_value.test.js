const assert = require('assert');
const test = require('node:test');

// The value each sketch's row of an app's Data tab fills its variable with, as serviceman would
// give it; a database's is real, and serviceman's alone (database_env)
test('a folder and REST each say the value they put in the app\'s variable', async function () {
    const app_data_value = (await import('../src/main/public/app_data_value.js')).default;
    const program = {name: 'crm', kind: 'program', host: 'crm.localhost'};

    // A folder: kept for it on its machine, a folder of the machine as typed, inside an image at
    // /data/files
    assert.strictEqual(app_data_value({kind: 'folder', from: 'kept', path: ''}, program), '~/serviceman-agent/data/crm/files');
    assert.strictEqual(app_data_value({kind: 'folder', from: 'machine', path: '/srv/photos'}, program), '/srv/photos');
    assert.strictEqual(app_data_value({kind: 'folder', from: 'machine', path: ''}, program), '/srv/files', 'nothing typed yet: the placeholder');
    assert.strictEqual(app_data_value({kind: 'folder', from: 'machine', path: '/srv/photos'}, {name: 'crm', kind: 'docker image', host: 'crm.localhost'}), '/data/files');

    // REST: /_data/ at its address; a page asks its own
    assert.strictEqual(app_data_value({kind: 'rest', keep: 'serviceman'}, program), 'http://crm.localhost/_data/');
    assert.strictEqual(app_data_value({kind: 'rest', keep: 'serviceman'}, {name: 'notes', kind: 'page', host: 'notes.localhost'}), '/_data/');
});

// Two rows never fill one variable unasked: a second database is DATABASE_URL_2
test('a new row takes its variable, or the same name with the first free number', async function () {
    const app_data_env_free = (await import('../src/main/public/app_data_env_free.js')).default;
    assert.strictEqual(app_data_env_free([], 'DATABASE_URL'), 'DATABASE_URL');
    assert.strictEqual(app_data_env_free(['FILES_DIR'], 'DATABASE_URL'), 'DATABASE_URL');
    assert.strictEqual(app_data_env_free(['DATABASE_URL'], 'DATABASE_URL'), 'DATABASE_URL_2');
    assert.strictEqual(app_data_env_free(['DATABASE_URL', 'DATABASE_URL_2'], 'DATABASE_URL'), 'DATABASE_URL_3');
    assert.strictEqual(app_data_env_free(['DATABASE_URL', 'DATABASE_URL_3'], 'DATABASE_URL'), 'DATABASE_URL_2', 'the first free one');
});

// The words an app's kind is said and found by on Apps, and what the Data tab tells apart by
test('an app\'s kind in the words of the New service form', async function () {
    const app_kind_of = (await import('../src/main/public/app_kind_of.js')).default;
    assert.strictEqual(app_kind_of({type: 'files', socket: null, app_folder: null}), 'page');
    assert.strictEqual(app_kind_of({type: 'external', socket: '~/agency.sock', app_folder: null}), 'socket');
    assert.strictEqual(app_kind_of({type: 'shell', socket: null, app_folder: '/srv/crm'}), 'app folder');
    assert.strictEqual(app_kind_of({type: 'docker', socket: null, app_folder: null}), 'docker image');
    assert.strictEqual(app_kind_of({type: 'shell', socket: null, app_folder: null}), 'program');
    assert.strictEqual(app_kind_of({type: 'external', socket: null, app_folder: null}), 'already running');
    assert.strictEqual(app_kind_of({type: 'other', socket: null, app_folder: null}), 'other');
});
