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

// A service's own storage is written by its container as whatever user its image runs as: the
// folder is open to every user, the agent's data/ above it the agent's alone; a folder of the
// File Manager stays as made, and so does one docker made before, as root
test('a kept folder is opened to its container, and the agent\'s data/ closed around it', async function (t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dir-'));
    const before = process.env.SERVICEMAN_AGENT_DIR;
    process.env.SERVICEMAN_AGENT_DIR = dir;
    const umask = process.umask(0o022);
    t.after(function () {
        process.umask(umask);
        process.env.SERVICEMAN_AGENT_DIR = before;
        fs.rmSync(dir, {recursive: true, force: true});
    });
    const kept = path.join(dir, 'data', 'authwall-team-a', 'app-data');
    assert.deepStrictEqual(await agent_dir_create(kept, undefined, true), {created: true});
    assert.strictEqual(fs.statSync(kept).mode & 0o777, 0o777);
    assert.strictEqual(fs.statSync(path.join(dir, 'data')).mode & 0o777, 0o700);

    fs.chmodSync(kept, 0o755);
    assert.deepStrictEqual(await agent_dir_create(kept, undefined, true), {created: false});
    assert.strictEqual(fs.statSync(kept).mode & 0o777, 0o777, 'one made before is opened at the next start');

    const plain = path.join(dir, 'files', 'notes');
    await agent_dir_create(plain);
    assert.strictEqual(fs.statSync(plain).mode & 0o777, 0o755, 'a folder that is no service\'s storage stays as made');
});
