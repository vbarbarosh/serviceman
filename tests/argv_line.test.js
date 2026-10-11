const agent_disk_list = require('../src/agent/src/agent_disk_list');
const agent_proc_list = require('../src/agent/src/agent_proc_list');
const argv_line = require('../src/helpers/argv_line');
const assert = require('assert');
const child_process = require('child_process');
const test = require('node:test');

test('a command line pasted into a shell runs the same argv again', function () {
    const argv = ['printf', '%s|', 'plain', 'two words', "it's", '$HOME', ';', '', 'a\tb', 'x=1,y+2'];
    assert.strictEqual(argv_line(['ps', '-eo', 'pid=,args=']), 'ps -eo pid=,args=');
    const printed = child_process.execFileSync('/bin/sh', ['-c', argv_line(argv)]).toString();
    assert.strictEqual(printed, argv.slice(2).map(v => `${v}|`).join(''));
});

test('a machine tab carries the commands its agent ran', async function () {
    const procs = await agent_proc_list();
    assert.deepStrictEqual(procs.commands, ['ps -eo pid=,ppid=,user:32=,pcpu=,pmem=,rss=,etimes=,stat=,args=']);
    const disks = await agent_disk_list();
    assert.deepStrictEqual(disks.commands, ['df -PkT', 'df -PiT']);
});
