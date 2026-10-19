const agent_update = require('../src/agent/src/agent_update');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const timers = require('timers/promises');

test('a bin/update that fails is said on the next ask, and the ask after that tries again', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-update-'));
    const was = process.env.SERVICEMAN_AGENT_DIR;
    process.env.SERVICEMAN_AGENT_DIR = dir;
    try {
        fs.mkdirSync(path.join(dir, 'bin'));
        // What a machine that cannot reach the host prints, and the code curl ends with
        fs.writeFileSync(path.join(dir, 'bin', 'update'), 'echo "curl: (7) Failed to connect to localhost port 3001"\nexit 7\n');
        const log_file = path.join(dir, 'logs', 'update.log');

        // The run's end is said at once, on stdout among the agent's other lines
        const said = [];
        const console_log = console.log;
        console.log = function (line) {
            said.push(String(line));
        };
        try {
            assert.deepStrictEqual(agent_update({}, 'c1'), {started: true});
            await until(() => said.some(v => v.includes('[agent_update_failed]')));
        }
        finally {
            console.log = console_log;
        }
        assert.match(said.find(v => v.includes('[agent_update_failed]')), /\[c1\]\[agent_update_failed\] reason="bin\/update failed with code 7: curl: \(7\) Failed to connect/);

        const again = agent_update();
        assert.strictEqual(again.started, false);
        assert.match(again.reason, /^bin\/update failed with code 7: curl: \(7\) Failed to connect to localhost port 3001$/);

        assert.deepStrictEqual(agent_update(), {started: true}, 'said once; the next ask runs it again');
        // That run ends before the next test asks: one run at a time is the agent's, whatever the folder
        await until(() => fs.existsSync(log_file) && fs.readFileSync(log_file, 'utf8').includes('ended with code'));
        await timers.setTimeout(200);
    }
    finally {
        if (was === undefined) {
            delete process.env.SERVICEMAN_AGENT_DIR;
        }
        else {
            process.env.SERVICEMAN_AGENT_DIR = was;
        }
    }
});

test('bin/update finds the node this agent runs on, wherever it lives', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-update-'));
    const was = process.env.SERVICEMAN_AGENT_DIR;
    process.env.SERVICEMAN_AGENT_DIR = dir;
    try {
        fs.mkdirSync(path.join(dir, 'bin'));
        // systemd's PATH leaves out ~/.local/bin, where node may be; the installer looks on PATH
        fs.writeFileSync(path.join(dir, 'bin', 'update'), 'echo "PATH=$PATH"\nexit 3\n');
        const log_file = path.join(dir, 'logs', 'update.log');
        assert.deepStrictEqual(agent_update(), {started: true});
        await until(() => fs.existsSync(log_file) && fs.readFileSync(log_file, 'utf8').includes('ended with code'));
        assert.strictEqual(agent_update().reason.startsWith(`bin/update failed with code 3: PATH=${path.dirname(process.execPath)}:`), true);
    }
    finally {
        if (was === undefined) {
            delete process.env.SERVICEMAN_AGENT_DIR;
        }
        else {
            process.env.SERVICEMAN_AGENT_DIR = was;
        }
    }
});

test('the end of a run another agent asked for is a run that worked, not a refusal', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-update-'));
    const was = process.env.SERVICEMAN_AGENT_DIR;
    process.env.SERVICEMAN_AGENT_DIR = dir;
    try {
        fs.mkdirSync(path.join(dir, 'bin'));
        fs.mkdirSync(path.join(dir, 'logs'));
        fs.writeFileSync(path.join(dir, 'bin', 'update'), 'exit 0\n');
        const log_file = path.join(dir, 'logs', 'update.log');
        // What the old agent's run leaves: bin/update says the new one is up, then it ends
        const ended = 'serviceman: the agent is up — systemctl --user status serviceman-agent\nserviceman: bin/update ended with code 0\n';
        fs.writeFileSync(log_file, `serviceman: bin/update asked by pid ${process.pid + 1}\n${ended}`);
        assert.deepStrictEqual(agent_update(), {started: true});
        await until(() => fs.readFileSync(log_file, 'utf8').includes('ended with code'));
        // The run is over once its process has gone, a moment after its last line
        await timers.setTimeout(200);

        // The same end, from a run this agent asked for: it is still here, so it did not take
        fs.writeFileSync(log_file, `serviceman: bin/update asked by pid ${process.pid}\n${ended}`);
        assert.strictEqual(agent_update().reason, 'bin/update ran to the end, and this agent is still the old one — it said: serviceman: the agent is up — systemctl --user status serviceman-agent');
    }
    finally {
        if (was === undefined) {
            delete process.env.SERVICEMAN_AGENT_DIR;
        }
        else {
            process.env.SERVICEMAN_AGENT_DIR = was;
        }
    }
});

test('an ask while a run is under way joins it: one bin/update at a time', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-update-'));
    const was = process.env.SERVICEMAN_AGENT_DIR;
    process.env.SERVICEMAN_AGENT_DIR = dir;
    try {
        fs.mkdirSync(path.join(dir, 'bin'));
        // Each run leaves a line of its own, where no other run writes over it
        fs.writeFileSync(path.join(dir, 'bin', 'update'), 'echo "a run" >> "$SERVICEMAN_AGENT_DIR/runs"\nsleep 1\nexit 0\n');
        const log_file = path.join(dir, 'logs', 'update.log');
        assert.deepStrictEqual(agent_update(), {started: true});
        assert.deepStrictEqual(agent_update(), {started: true});
        assert.deepStrictEqual(agent_update(), {started: true});
        await until(() => fs.readFileSync(log_file, 'utf8').includes('ended with code'));
        await timers.setTimeout(200);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'runs'), 'utf8'), 'a run\n');
    }
    finally {
        if (was === undefined) {
            delete process.env.SERVICEMAN_AGENT_DIR;
        }
        else {
            process.env.SERVICEMAN_AGENT_DIR = was;
        }
    }
});

async function until(check)
{
    for (let i = 0; i < 100; i++) {
        if (check()) {
            return;
        }
        await timers.setTimeout(50);
    }
    throw new Error('it never happened');
}
