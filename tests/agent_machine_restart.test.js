const agent_machine_restart = require('../src/agent/src/agent_machine_restart');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// A machine under a folder with these programs in it, each a script that writes down how it
// was asked and ends with `code`, saying `said` on stderr
function machine_make(t, files, code, said)
{
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-machine-restart-'));
    t.after(() => fs.rmSync(base, {recursive: true, force: true}));
    for (const name of files) {
        const file = path.join(base, name);
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, `#!/bin/sh\necho "$0 $*" >> ${base}/asked\n${(said === undefined) ? '' : `echo "${said}" >&2\n`}exit ${code}\n`, {mode: 0o755});
    }
    function asked() {
        const file = path.join(base, 'asked');
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map(v => v.slice(base.length)) : [];
    }
    return {base, asked};
}

// A run() that keeps what it was handed instead of running it
function run_kept()
{
    const out = {runs: [], failed: null};
    out.run = function (file, argv, failed) {
        out.runs.push([file, argv]);
        out.failed = failed;
    };
    return out;
}

function sleep(ms)
{
    return new Promise(v => setTimeout(v, ms));
}

// The answer comes first and nothing is run yet; systemctl reboot a moment on
test('a restart answers first, then asks systemctl to reboot', async function (t) {
    const machine = machine_make(t, ['/usr/bin/systemctl', '/usr/sbin/shutdown'], 0);
    const kept = run_kept();
    const answer = await agent_machine_restart({restart_root_dir: machine.base, restart_after_ms: 50, restart_run: kept.run}, 'g');
    assert.deepStrictEqual([answer.restarting, answer.by, typeof answer.uptime_ms], [true, 'systemctl reboot', 'number']);
    assert.deepStrictEqual(kept.runs, [], 'nothing runs before the answer is out');
    await sleep(150);
    assert.deepStrictEqual(kept.runs, [[path.join(machine.base, '/usr/bin/systemctl'), ['reboot']]]);
});

// No systemctl: the older shutdown, which systemd also takes
test('a machine with no systemctl is restarted by shutdown -r now', async function (t) {
    const machine = machine_make(t, ['/sbin/shutdown'], 0);
    const kept = run_kept();
    const answer = await agent_machine_restart({restart_root_dir: machine.base, restart_after_ms: 10, restart_run: kept.run}, 'g');
    assert.strictEqual(answer.by, 'shutdown -r now');
    await sleep(80);
    assert.deepStrictEqual(kept.runs, [[path.join(machine.base, '/sbin/shutdown'), ['-r', 'now']]]);
});

// Neither: refused before anything happens, and nothing runs later either
test('a machine with neither program is refused, and nothing is run', async function (t) {
    const machine = machine_make(t, [], 0);
    const kept = run_kept();
    await assert.rejects(agent_machine_restart({restart_root_dir: machine.base, restart_after_ms: 10, restart_run: kept.run}, 'g'), {message: 'this machine has neither systemctl nor shutdown to restart it with'});
    await sleep(60);
    assert.deepStrictEqual(kept.runs, []);
});

// The real run: the program asked as written; one that ends with 0 is no error, one that ends
// otherwise fails with its last line, and one that cannot start fails with why
test('the program runs, and how it ends is the error said after the answer', async function (t) {
    const ok = machine_make(t, ['/usr/bin/systemctl'], 0);
    const errors = [];
    await agent_machine_restart({restart_root_dir: ok.base, restart_after_ms: 0}, 'g');
    await sleep(300);
    assert.deepStrictEqual(ok.asked(), ['/usr/bin/systemctl reboot']);
    const refused = machine_make(t, ['/usr/bin/systemctl'], 1, 'Failed to reboot system via logind: Access denied');
    const run = agent_machine_restart.spawn_run;
    await new Promise(function (resolve) {
        run(path.join(refused.base, '/usr/bin/systemctl'), ['reboot'], function (error) {
            errors.push(error.message);
            resolve();
        });
    });
    await new Promise(function (resolve) {
        run(path.join(refused.base, '/nowhere/systemctl'), ['reboot'], function (error) {
            errors.push(error.code);
            resolve();
        });
    });
    await sleep(100);
    assert.deepStrictEqual(errors, ['Failed to reboot system via logind: Access denied', 'ENOENT'], 'a program that cannot start is said once');
});
