const agent_volumes_link = require('../src/agent/src/agent_volumes_link');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

test('the agent\'s folder gets a link to the volume files once there are any, and keeps what is there', function (t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-volumes-link-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const volumes = path.join(root, 'var-lib-serviceman-volumes');
    const folder = path.join(root, 'serviceman-agent');
    fs.mkdirSync(folder);
    agent_volumes_link({volumes_dir: volumes}, folder);
    assert.strictEqual(fs.existsSync(path.join(folder, 'volumes')), false, 'no volumes yet, no link to nothing');
    fs.mkdirSync(volumes);
    agent_volumes_link({volumes_dir: volumes}, folder);
    assert.strictEqual(fs.readlinkSync(path.join(folder, 'volumes')), volumes);
    fs.rmSync(path.join(folder, 'volumes'));
    fs.mkdirSync(path.join(folder, 'volumes'));
    agent_volumes_link({volumes_dir: volumes}, folder);
    assert.strictEqual(fs.lstatSync(path.join(folder, 'volumes')).isDirectory(), true, 'a folder of its own there is left alone');
});
