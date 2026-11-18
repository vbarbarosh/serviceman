const agent_child_env = require('../src/agent/src/agent_child_env');
const agent_program_logs = require('../src/agent/src/agent_program_logs');
const agent_program_start = require('../src/agent/src/agent_program_start');
const agent_program_step = require('../src/agent/src/agent_program_step');
const agent_program_stop = require('../src/agent/src/agent_program_stop');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const timers = require('timers/promises');

// An agent installed by its script has its token in its env (SERVICEMAN_TOKEN, from its env
// file); what it starts for a service never sees it: a page that prints its env would show it
test('what the agent starts has the agent\'s env but its token, and what it is given on top', async function () {
    await within_agent(async function () {
        const env = agent_child_env({OWN: 'yes'}, {TERM: 'xterm-256color'});
        assert.strictEqual(env.SERVICEMAN_TOKEN, undefined);
        assert.strictEqual(env.SERVICEMAN_URL, 'https://serviceman.example.com', 'the rest of the agent\'s env stays');
        assert.strictEqual(env.OWN, 'yes');
        assert.strictEqual(env.TERM, 'xterm-256color');
        assert.strictEqual(agent_child_env({SERVICEMAN_TOKEN: 'its own'}).SERVICEMAN_TOKEN, 'its own', 'a service that names one of its own keeps it');
        assert.strictEqual(process.env.SERVICEMAN_TOKEN, 'the-machines-token', 'the agent keeps its own');

        // A program, as a service of the shell kind runs
        const params = {name: 'env-print', slot: 1, argv: ['sh', '-c', 'echo "token=[$SERVICEMAN_TOKEN] own=[$OWN]"; sleep 30'], cwd: null, env: {OWN: 'yes'}};
        const state = {programs: {}};
        agent_program_start(state, params, 'c1');
        await until(() => agent_program_logs(state, params).text.includes('token='));
        assert.match(agent_program_logs(state, params).text, /^token=\[\] own=\[yes\]$/m);
        await agent_program_stop(state, params, 'c1');

        // A line of its life, install or stop, run the same way
        const said = [];
        await agent_program_step({docker: 'docker'}, {line: 'echo "token=[$SERVICEMAN_TOKEN] own=[$OWN]"', cwd: null, env: {OWN: 'yes'}}, (name, line) => said.push(line));
        assert.deepStrictEqual(said, ['token=[] own=[yes]']);
    });
});

async function within_agent(fn)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-child-env-'));
    const was = {SERVICEMAN_AGENT_DIR: process.env.SERVICEMAN_AGENT_DIR, SERVICEMAN_SERVICES_DIR: process.env.SERVICEMAN_SERVICES_DIR, SERVICEMAN_TOKEN: process.env.SERVICEMAN_TOKEN, SERVICEMAN_URL: process.env.SERVICEMAN_URL};
    Object.assign(process.env, {SERVICEMAN_AGENT_DIR: dir, SERVICEMAN_SERVICES_DIR: path.join(dir, 'services'), SERVICEMAN_TOKEN: 'the-machines-token', SERVICEMAN_URL: 'https://serviceman.example.com'});
    const console_log = console.log;
    console.log = function () {
        // The agent's lines; the test reads the logs the agent keeps instead
    };
    try {
        await fn(dir);
    }
    finally {
        console.log = console_log;
        for (const name of Object.keys(was)) {
            if (was[name] === undefined) {
                delete process.env[name];
            }
            else {
                process.env[name] = was[name];
            }
        }
        fs.rmSync(dir, {recursive: true, force: true});
    }
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
