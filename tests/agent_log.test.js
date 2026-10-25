const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

// The agent's daily file holds command lines, paths and what programs printed: the agent's
// user's alone, in a folder of its own
test('the agent\'s log folder and its daily file are the agent\'s user\'s alone, a day from before too', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serviceman-agent-log-'));
    const was = process.env.SERVICEMAN_LOG_DIR;
    process.env.SERVICEMAN_LOG_DIR = dir;
    const file = path.join(dir, 'agent', `${day_now()}.txt`);
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o755});
    fs.writeFileSync(file, 'from before\n', {mode: 0o644});
    const agent_log_path = require.resolve('../src/agent/src/agent_log');
    delete require.cache[agent_log_path];
    try {
        const agent_log = require(agent_log_path);
        agent_log('[t][c][x] one');
        assert.strictEqual(fs.statSync(path.dirname(file)).mode & 0o777, 0o700, 'the folder');
        assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'the file');
        await new Promise(v => setTimeout(v, 100));
        assert.strictEqual(fs.readFileSync(file, 'utf8'), 'from before\n[t][c][x] one\n');
    }
    finally {
        delete require.cache[agent_log_path];
        if (was === undefined) {
            delete process.env.SERVICEMAN_LOG_DIR;
        }
        else {
            process.env.SERVICEMAN_LOG_DIR = was;
        }
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

function day_now()
{
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}
