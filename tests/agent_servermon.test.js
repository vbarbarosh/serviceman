const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const timers = require('timers/promises');

const AGENT = path.join(__dirname, '..', 'src', 'agent', 'index.js');

// The agent writes servermon.js beside itself and starts it; servermon writes a line a second
// into logs/servermon/. The agent's own log is logs/agent/<day>.txt, and the days an older agent
// left in logs/ are moved in there. A restart of the agent takes the same servermon back.
test('the agent starts servermon, keeps it across its own restart, and logs into logs/agent', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-servermon-'));
    const logs = path.join(dir, 'logs');
    fs.mkdirSync(logs);
    fs.writeFileSync(path.join(logs, '20260101.log'), 'a line of an older agent\n');
    const env = Object.assign({}, process.env, {SERVICEMAN_AGENT_DIR: dir, SERVICEMAN_LOG_DIR: logs});
    const argv = [AGENT, '--url', 'http://127.0.0.1:9', '--token', 'servermonservermonservermonserv', '--machine', 'servermon', '--peer-port', '0'];
    let agent = child_process.spawn(process.execPath, argv, {stdio: 'ignore', env});
    let pid = null;
    try {
        const record = await record_wait(path.join(dir, 'servermon.json'));
        pid = record.pid;
        const day_files = await day_files_wait(path.join(logs, 'servermon'));
        const line = JSON.parse(fs.readFileSync(path.join(logs, 'servermon', day_files[0]), 'utf8').split('\n')[0]);
        assert.deepStrictEqual(Object.keys(line).slice(0, 3), ['time', 'cpu', 'steal']);
        assert.ok(fs.existsSync(path.join(dir, 'servermon.js')), 'servermon.js is written beside the agent');
        assert.strictEqual(fs.readFileSync(path.join(logs, 'agent', '20260101.txt'), 'utf8'), 'a line of an older agent\n');
        assert.ok(fs.readdirSync(path.join(logs, 'agent')).some(v => /^\d{8}\.txt$/.test(v) && (v !== '20260101.txt')), 'today has a file of its own');
        assert.strictEqual(fs.existsSync(path.join(logs, '20260101.log')), false);

        agent.kill('SIGKILL');
        await timers.setTimeout(200);
        assert.doesNotThrow(() => process.kill(pid, 0), 'servermon outlives the agent');
        agent = child_process.spawn(process.execPath, argv, {stdio: 'ignore', env});
        assert.match(await status_wait(env), new RegExp(`^servermon pid ${pid},`, 'm'), 'the agent took the same servermon back');
    }
    finally {
        agent.kill('SIGKILL');
        if (pid !== null) {
            process.kill(pid, 'SIGKILL');
        }
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

async function record_wait(file)
{
    const until = Date.now() + 8000;
    while (Date.now() < until) {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
        await timers.setTimeout(100);
    }
    throw new Error(`${file} was not written`);
}

// What the agent says it is doing, once it answers
async function status_wait(env)
{
    const until = Date.now() + 8000;
    while (Date.now() < until) {
        const answer = child_process.spawnSync(process.execPath, [AGENT, '--status'], {env, encoding: 'utf8'});
        if (answer.status === 0) {
            return answer.stdout;
        }
        await timers.setTimeout(100);
    }
    throw new Error('the agent did not answer --status');
}

async function day_files_wait(dir)
{
    const until = Date.now() + 8000;
    while (Date.now() < until) {
        const names = (fs.existsSync(dir) ? fs.readdirSync(dir).filter(v => /^\d{8}\.jsonl$/.test(v)) : []);
        if ((names.length > 0) && (fs.readFileSync(path.join(dir, names[0]), 'utf8').includes('\n'))) {
            return names;
        }
        await timers.setTimeout(100);
    }
    throw new Error(`servermon wrote nothing into ${dir}`);
}
