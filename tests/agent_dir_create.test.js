const agent_dir_create = require('../src/agent/src/agent_dir_create');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

test('a folder is made with every folder above it; one written without a root is under the home, whatever the working folder', async function (t) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-home-'));
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cwd-'));
    const home_before = process.env.HOME;
    const cwd_before = process.cwd();
    process.env.HOME = home;
    process.chdir(elsewhere);
    t.after(function () {
        process.env.HOME = home_before;
        process.chdir(cwd_before);
        fs.rmSync(home, {recursive: true, force: true});
        fs.rmSync(elsewhere, {recursive: true, force: true});
    });
    assert.deepStrictEqual(await agent_dir_create('ggg/dev.feedapp'), {created: true});
    assert.strictEqual(fs.statSync(path.join(home, 'ggg', 'dev.feedapp')).isDirectory(), true);
    assert.deepStrictEqual(fs.readdirSync(elsewhere), []);
    assert.deepStrictEqual(await agent_dir_create('~/ggg/dev.feedapp'), {created: false});
    assert.deepStrictEqual(await agent_dir_create(path.join(home, 'a', 'b')), {created: true});
    assert.strictEqual(fs.existsSync(path.join(home, '~')), false, 'no folder named ~');
});
