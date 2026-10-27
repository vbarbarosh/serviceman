const agent_apt = require('../src/agent/src/agent_apt');
const agent_apt_lists_at = require('../src/agent/src/agent_apt_lists_at');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// A machine's apt under a folder of its own: an apt-get that writes down what it was asked and
// takes `wait` seconds over each run, and fails an update where `fail` says
function apt_make(t, wait, fail)
{
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-apt-lists-'));
    t.after(() => fs.rmSync(base, {recursive: true, force: true}));
    const asked = path.join(base, 'asked');
    const apt = path.join(base, 'apt-get');
    fs.writeFileSync(apt, `#!/bin/sh\necho "$*" | cut -d' ' -f1-2 >> ${asked}\nsleep ${wait}\n${fail ? 'case "$*" in *update*) echo "E: The repository \'https://example.com stable Release\' does not have a Release file." >&2; exit 100 ;; esac\n' : ''}exit 0\n`, {mode: 0o755});
    return {base, apt, asked: () => (fs.existsSync(asked) ? fs.readFileSync(asked, 'utf8').trim().split('\n') : [])};
}

function mtime_set(file, ms)
{
    fs.mkdirSync(path.dirname(file), {recursive: true});
    if (fs.existsSync(file) === false) {
        fs.writeFileSync(file, '');
    }
    fs.utimesSync(file, new Date(ms), new Date(ms));
}

// The lists' age is the newer of apt's stamp of a fetch that went well and the lists' folder,
// whichever the machine has; neither is none
test('the lists were fetched when apt\'s stamp or their folder last says so', function (t) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-apt-lists-'));
    t.after(() => fs.rmSync(base, {recursive: true, force: true}));
    assert.strictEqual(agent_apt_lists_at(base), null);
    const lists = path.join(base, 'var/lib/apt/lists');
    fs.mkdirSync(lists, {recursive: true});
    fs.utimesSync(lists, new Date(1700000000000), new Date(1700000000000));
    assert.strictEqual(agent_apt_lists_at(base), 1700000000000);
    mtime_set(path.join(base, agent_apt_lists_at.STAMP), 1700000500000);
    assert.strictEqual(agent_apt_lists_at(base), 1700000500000);
});

// A fetch that went well touches apt's stamp, so the lists are as old as that fetch even where
// no list changed; one that failed leaves it, and says apt's error
test('a fetch of the lists marks its time where it went well, and says apt\'s error where not', async function (t) {
    const ok = apt_make(t, 0, false);
    const stamp = path.join(ok.base, agent_apt_lists_at.STAMP);
    const before = Date.now();
    const answer = await agent_apt.refresh({}, {apt: ok.apt, apt_root_dir: ok.base});
    assert.deepStrictEqual([answer.ok, answer.skipped, answer.code], [true, false, 0]);
    assert.deepStrictEqual(ok.asked(), ['-q update']);
    assert.ok(fs.statSync(stamp).mtimeMs >= before - 1000, 'the stamp is touched now');

    const bad = apt_make(t, 0, true);
    const failed = await agent_apt.refresh({}, {apt: bad.apt, apt_root_dir: bad.base});
    assert.deepStrictEqual([failed.ok, failed.code], [false, 100]);
    assert.match(failed.stderr, /^E: The repository/);
    assert.strictEqual(fs.existsSync(path.join(bad.base, agent_apt_lists_at.STAMP)), false);
});

// One apt at a time: a fetch is not started while apt runs, and Install asked during a fetch
// waits for it, then fetches again itself and upgrades
test('a fetch waits for nobody and is waited for by Install', async function (t) {
    const fake = apt_make(t, 0.3, false);
    const options = {apt: fake.apt, apt_root_dir: fake.base};
    const state = {};
    const fetching = agent_apt.refresh(state, options);
    const second = await agent_apt.refresh(state, options);
    assert.deepStrictEqual([second.ok, second.skipped], [false, true], 'a second fetch is not started beside the first');
    const installed = await agent_apt(state, options, null);
    assert.strictEqual(installed.ok, true);
    assert.strictEqual((await fetching).ok, true);
    assert.deepStrictEqual(fake.asked(), ['-q update', 'update', '-y -o'], 'Install started once the fetch had ended');
    assert.deepStrictEqual([state.apt, state.apt_refresh], [null, null]);
});
