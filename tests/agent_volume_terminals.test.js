const agent_volume_terminals = require('../src/agent/src/agent_volume_terminals');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

test('a user under a terminal\'s holder is named by that terminal, the rest are not', function (t) {
    // holder 100 (terminal "work") > bash 101 > vim 102; a container's sleep 300 under its shim 200
    const proc = fake_proc(t, {100: 1, 101: 100, 102: 101, 200: 1, 300: 200});
    const refusal = {ok: false, status: 409, error: '"notes" is in use', users: [
        {pid: 102, how: 'open file', user: 'user', command: 'vim'},
        {pid: 300, how: 'a container holds it', user: 'root', command: 'sleep'},
        {pid: 999, how: 'cwd', user: 'user', command: 'gone'},
    ]};
    agent_volume_terminals(refusal, {100: 'work'}, proc);
    assert.deepStrictEqual(refusal.users.map(v => [v.pid, v.terminal]), [[102, 'work'], [300, null], [999, null]]);
});

test('the list gets it per volume, and a value with no users stays as it was', function (t) {
    const proc = fake_proc(t, {100: 1, 101: 100});
    const list = {ok: true, items: [{name: 'a', users: [{pid: 101}]}, {name: 'b', users: []}], disk_free: 1};
    agent_volume_terminals(list, {100: 'agent-1'}, proc);
    assert.deepStrictEqual(list.items.map(v => v.users.map(vv => vv.terminal)), [['agent-1'], []]);
    assert.deepStrictEqual(agent_volume_terminals({ok: true, name: 'c'}, {}, proc), {ok: true, name: 'c'});
});

// /proc/<pid>/stat for each pid, its command with a space and a parenthesis, as real ones may have
function fake_proc(t, parents)
{
    const proc = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-volume-terminals-'));
    t.after(() => fs.rmSync(proc, {recursive: true, force: true}));
    for (const [pid, parent] of Object.entries(parents)) {
        fs.mkdirSync(path.join(proc, pid));
        fs.writeFileSync(path.join(proc, pid, 'stat'), `${pid} (a (b) c) S ${parent} ${pid} ${pid} 0 -1\n`);
    }
    return proc;
}
