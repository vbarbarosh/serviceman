const app_from_config = require('../src/main/src/helpers/app_from_config');
const assert = require('assert');
const config_from_json = require('../src/main/src/helpers/config_from_json');
const doors_tell = require('../src/main/src/helpers/doors_tell');
const forwards_tell = require('../src/main/src/helpers/forwards_tell');
const fs = require('fs');
const os = require('os');
const path = require('path');
const shared_tell = require('../src/main/src/helpers/shared_tell');
const test = require('node:test');

const TOKEN = 'cccccccccccccccccccccccccccccccc';

// A machine is told its forwards, its doors and its shared folders at its hello and on the
// minute, by calls nobody waits for. What they read is what the machine said of itself, and a
// machine says what it will: read wrongly there, one frame ended serviceman.
test('a hello whose `can` is no list stops no telling', async function () {
    const app = app_made();
    const remote = app.remote_by_name.laptop;
    remote.state.phase = 'online';
    for (const can of [{}, 'forwards', 5, null]) {
        remote.state.resources = {can};
        await forwards_tell(app);
        await doors_tell(app);
        await shared_tell(app);
    }
    assert.strictEqual(remote.state.forwards_told, null, 'a machine that names no list is told nothing');
});

test('a kept answer of another shape is a line in the log, not the end of the process', async function () {
    const app = app_made();
    const remote = app.remote_by_name.laptop;
    remote.state.phase = 'online';
    remote.state.resources = {can: ['forwards']};
    // What a machine once answered forwards_set with, kept as it came
    remote.state.forwards_said = {x: null};
    await forwards_tell(app);
    assert.strictEqual(app.log_lines.some(v => /\[forwards_tell_error\] reason=/.test(v)), true);
});

test('a kept table of shared folders that does not read is a line in the log, not the end of the process', async function () {
    const app = app_made();
    fs.writeFileSync(path.join(app.state_dir, 'shared_folders.json'), '{"mounts": [');
    await shared_tell(app);
    assert.strictEqual(app.log_lines.some(v => /\[shared_tell_error\] reason=/.test(v)), true);
});

// A serviceman that listens nowhere, with one machine and a state folder of its own
function app_made()
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-tellings-'));
    test.after(function () {
        fs.rmSync(dir, {recursive: true, force: true});
    });
    const app = app_from_config(config_from_json({services: [], remotes: [{name: 'laptop', token: TOKEN}]}, dir));
    app.state_dir = dir;
    return app;
}
