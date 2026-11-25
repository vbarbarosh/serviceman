const agent_apt = require('../src/agent/src/agent_apt');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const ANSWERS = '-y -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef';

// A machine under a folder of its own, with an apt-get and a snap that write down what they were
// asked, in the order asked, and end with the code `codes` gives each of them
function machine_make(t, codes)
{
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-apt-upgrade-'));
    t.after(() => fs.rmSync(base, {recursive: true, force: true}));
    const asked = path.join(base, 'asked');
    const tools = {};
    for (const name of ['apt-get', 'snap']) {
        tools[name] = path.join(base, name);
        const code = ((codes !== undefined) && (codes[name] !== undefined)) ? codes[name] : 0;
        fs.writeFileSync(tools[name], `#!/bin/sh\necho "${name} $*" >> ${asked}\necho "${name} said $1"\nexit ${code}\n`, {mode: 0o755});
    }
    return {base, apt: tools['apt-get'], snap: tools.snap, asked: () => (fs.existsSync(asked) ? fs.readFileSync(asked, 'utf8').trim().split('\n') : [])};
}

// What a person types to bring a machine up to date: the lists, a full upgrade that answers
// apt's questions, then the snaps; every line said as it comes
test('Install fetches the lists, runs a full upgrade, then refreshes the snaps', async function (t) {
    const machine = machine_make(t);
    const said = [];
    const answer = await agent_apt({}, {apt: machine.apt, snap: machine.snap, apt_root_dir: machine.base}, (name, text) => said.push(text));
    assert.deepStrictEqual([answer.ok, answer.code], [true, 0]);
    assert.deepStrictEqual(machine.asked(), ['apt-get update', `apt-get ${ANSWERS} full-upgrade`, 'snap refresh']);
    assert.deepStrictEqual(said, ['apt-get said update', 'apt-get said -y', 'snap said refresh']);
});

// A Debian, a container: no snap anywhere, so Install is apt alone and still goes well
test('a machine with no snap is upgraded by apt alone', async function (t) {
    const machine = machine_make(t);
    const answer = await agent_apt({}, {apt: machine.apt, apt_root_dir: machine.base}, null);
    assert.deepStrictEqual([answer.ok, answer.code], [true, 0]);
    assert.deepStrictEqual(machine.asked(), ['apt-get update', `apt-get ${ANSWERS} full-upgrade`]);
});

// Each step runs only once the one before went well, and a step that fails is how Install ends
test('a failed step stops Install there, and says its code', async function (t) {
    const unfetched = machine_make(t, {'apt-get': 100});
    const first = await agent_apt({}, {apt: unfetched.apt, snap: unfetched.snap, apt_root_dir: unfetched.base}, null);
    assert.deepStrictEqual([first.ok, first.code], [false, 100]);
    assert.deepStrictEqual(unfetched.asked(), ['apt-get update'], 'no upgrade, no snap refresh');

    // sudo with no sudoers line for snap: apt has installed its updates, and Install says the
    // snaps failed rather than calling the whole of it done
    const refused = machine_make(t, {snap: 1});
    const second = await agent_apt({}, {apt: refused.apt, snap: refused.snap, apt_root_dir: refused.base}, null);
    assert.deepStrictEqual([second.ok, second.code], [false, 1]);
    assert.deepStrictEqual(refused.asked(), ['apt-get update', `apt-get ${ANSWERS} full-upgrade`, 'snap refresh']);
});
