const agent_program_logs = require('../src/agent/src/agent_program_logs');
const agent_program_probe = require('../src/agent/src/agent_program_probe');
const agent_program_start = require('../src/agent/src/agent_program_start');
const agent_program_stop = require('../src/agent/src/agent_program_stop');
const agent_programs_adopt = require('../src/agent/src/agent_programs_adopt');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const timers = require('timers/promises');

// A program that says a line at once and one more every tenth of a second, as a server says a
// line for every request
const ARGV = ['sh', '-c', 'echo hello; i=0; while true; do i=$((i+1)); echo "tick $i"; sleep 0.1; done'];

test('a program outlives the agent that started it, and the next agent takes it back', async function () {
    await within_agent_dir(async function (dir) {
        const params = {name: 'hello', slot: 1, argv: ARGV, cwd: null};
        const first = {programs: {}};
        const started = agent_program_start(first, params, 'c1');
        assert.strictEqual(started.started, true);
        await until(() => agent_program_logs(first, params).text.includes('tick 2'));

        // A new agent: nothing in memory, only what the first one wrote down
        const second = {programs: {}};
        agent_programs_adopt(second.programs, 'c2');
        assert.deepStrictEqual(agent_program_probe(second, params), {running: true, pid: started.pid});
        assert.match(agent_program_logs(second, params).text, /^hello$/m, 'the log the first agent had');
        const ticks = tick_last(agent_program_logs(second, params).text);
        await until(() => tick_last(agent_program_logs(second, params).text) > ticks + 2);
        assert.deepStrictEqual(agent_program_start(second, params, 'c2'), {pid: started.pid, started: false}, 'never a second copy');

        const stopped = await agent_program_stop(second, params, 'c2');
        assert.strictEqual(stopped.stopped, true);
        await until(() => fs.existsSync(path.join(dir, 'programs', 'hello.1.json')) === false);
        assert.throws(() => process.kill(started.pid, 0), {code: 'ESRCH'});
        assert.deepStrictEqual(agent_program_probe(second, params), {running: false, pid: null});
    });
});

test('a note whose pid now names another process is not taken back', async function () {
    await within_agent_dir(async function (dir) {
        const params = {name: 'gone', slot: 1};
        fs.mkdirSync(path.join(dir, 'programs'));
        // This test's own pid, with a start time that is not its own: a pid the kernel gave again
        const record = {name: 'gone', slot: 1, pid: process.pid, started: '1', cwd: null, dir, argv: ['x']};
        fs.writeFileSync(path.join(dir, 'programs', 'gone.1.json'), JSON.stringify(record));
        fs.writeFileSync(path.join(dir, 'programs', 'gone.1.out'), 'old words\n');
        const state = {programs: {}};
        agent_programs_adopt(state.programs, 'c1');
        assert.deepStrictEqual(agent_program_probe(state, params), {running: false, pid: null});
        assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'programs')), [], 'the note and its files are taken away');
    });
});

test('a program that ends by itself takes its note with it', async function () {
    await within_agent_dir(async function (dir) {
        const params = {name: 'brief', slot: 1, argv: ['sh', '-c', 'echo done'], cwd: null};
        const state = {programs: {}};
        agent_program_start(state, params, 'c1');
        await until(() => agent_program_probe(state, params).running === false);
        assert.strictEqual(fs.existsSync(path.join(dir, 'programs', 'brief.1.json')), false);
    });
});

async function within_agent_dir(fn)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-programs-'));
    const was = process.env.SERVICEMAN_AGENT_DIR;
    process.env.SERVICEMAN_AGENT_DIR = dir;
    const console_log = console.log;
    console.log = function () {
        // The agent's lines; the test reads the logs the agent keeps instead
    };
    try {
        await fn(dir);
    }
    finally {
        console.log = console_log;
        if (was === undefined) {
            delete process.env.SERVICEMAN_AGENT_DIR;
        }
        else {
            process.env.SERVICEMAN_AGENT_DIR = was;
        }
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

function tick_last(text)
{
    const ticks = [...text.matchAll(/^tick (\d+)$/gm)];
    return ((ticks.length === 0) ? 0 : Number(ticks[ticks.length - 1][1]));
}

async function until(fn)
{
    const deadline = Date.now() + 5000;
    while (fn() === false) {
        if (Date.now() > deadline) {
            throw new Error(`not in time: ${fn}`);
        }
        await timers.setTimeout(50);
    }
}
